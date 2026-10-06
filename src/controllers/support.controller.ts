import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { settingModel } from "../models/setting.model.js";
import { supportCategoryModel } from "../models/supportCategory.model.js";
import { LINKS, supportTicketModel } from "../models/supportTicket.model.js";
import { supportMessageModel } from "../models/supportMessage.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { emitToSupportDesk } from "../services/socket.service.js";
import {
  announceMessage,
  announceRead,
  announceTicket,
  deleteTicketMessage,
  discardAttachments,
  filesOf,
  postTicketMessage,
  storeAttachments,
  ticketNotFound,
} from "../services/support.service.js";
import {
  staffTicketView,
  ticketAuditView,
  userMessageView,
  userTicketDetailView,
  userTicketView,
} from "../services/supportViews.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateTicketInput,
  ListMessagesQuery,
  ListMyTicketsQuery,
  PostMessageInput,
  RateTicketInput,
} from "../schemas/support.schema.js";

export const TICKET_ACTIVITY = { module: "support", targetType: "supportTicket" } as const;
export const MESSAGE_ACTIVITY = { module: "support", targetType: "supportMessage" } as const;
export const REDACT = ["subject", "message", "body", "comment"];

function raiser(req: Request): { userId: string; role: "rider" | "driver" } {
  const role = req.auth?.role;
  if (role !== "rider" && role !== "driver") {
    throw AppError.forbidden("Only riders and drivers can use support tickets");
  }
  return { userId: req.auth!.id, role };
}

// A new ticket needs a message or a file, a category the raiser can use, and only the raiser's own linked records.
export async function checkNewTicket(
  input: CreateTicketInput,
  files: Express.Multer.File[],
  userId: string,
  role: "rider" | "driver",
) {
  if (!input.message && files.length === 0) {
    throw AppError.badRequest("Write a message or attach a file");
  }
  const category = await supportCategoryModel.findById(input.categoryId);
  if (!category || !category.isActive || (category.audience !== "all" && category.audience !== role)) {
    throw AppError.badRequest(`Support category not available: ${input.categoryId}`);
  }
  for (const link of Object.keys(LINKS) as (keyof typeof LINKS)[]) {
    const id = input[link];
    if (id && !(await supportTicketModel.ownsLink(link, id, userId))) {
      throw AppError.notFound(`${LINKS[link].label} not found: ${id}`);
    }
  }
  return category;
}

export async function createTicket(req: Request, res: Response) {
  const { userId, role } = raiser(req);
  const input = req.validated.body as CreateTicketInput;
  const files = filesOf(req);

  const category = await checkNewTicket(input, files, userId, role);

  const id = randomUUID();
  const attachments = await storeAttachments(files, id);
  let created: Awaited<ReturnType<typeof supportTicketModel.create>>;
  try {
    created = await supportTicketModel.create({
      id,
      userId,
      raiserRole: role,
      categoryId: category.id,
      subject: input.subject,
      priority: category.defaultPriority,
      tripId: input.tripId,
      transactionId: input.transactionId,
      payoutId: input.payoutId,
      relatedTicketId: input.relatedTicketId,
      body: input.message ?? null,
      attachments,
    });
  } catch (err) {
    await discardAttachments(attachments);
    throw err;
  }
  const { ticket } = created;
  const activity = await supportTicketModel.activity([ticket], "user");

  sendCreated(res, "Support ticket created successfully", userTicketView(ticket, activity.get(ticket.id)));

  emitToSupportDesk("support:ticketCreated", { ticket: staffTicketView(ticket) });
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.create",
    description: `Opened support ticket ${ticket.code}`,
    targetId: ticket.id,
    after: ticketAuditView(ticket),
    redact: REDACT,
  });
}

export async function listMyTickets(req: Request, res: Response) {
  const { userId } = raiser(req);
  const query = req.validated.query as ListMyTicketsQuery;

  await supportTicketModel.sweep({ userId });
  const { items, totalItems } = await supportTicketModel.listForUser(userId, query);
  const ids = items.map((t) => t.id);
  const [activity, matches] = await Promise.all([
    supportTicketModel.activity(items, "user"),
    supportTicketModel.matchedMessages(ids, query.q, false),
  ]);

  sendSuccess(res, "Support tickets retrieved successfully", {
    items: items.map((ticket) => ({
      ...userTicketView(ticket, activity.get(ticket.id)),
      matchedMessage: matches.get(ticket.id) ?? null,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });
}

export async function getMyTicket(req: Request, res: Response) {
  const { userId } = raiser(req);
  const { id } = req.validated.params as { id: string };

  await supportTicketModel.sweep({ id });
  const ticket = await supportTicketModel.findOwned(id, userId);
  if (!ticket) throw ticketNotFound(id);
  const [activity, windowDays] = await Promise.all([
    supportTicketModel.activity([ticket], "user"),
    settingModel.getValue("support.reopenWindowDays"),
  ]);

  sendSuccess(
    res,
    "Support ticket retrieved successfully",
    userTicketDetailView(ticket, activity.get(id), windowDays),
  );
}

export async function resolveMyTicket(req: Request, res: Response) {
  const { userId } = raiser(req);
  const { id } = req.validated.params as { id: string };

  await supportTicketModel.sweep({ id });
  const result = await supportTicketModel.resolveByUser(id, userId);
  if (!result.ok) {
    if (result.reason === "notFound") throw ticketNotFound(id);
    throw AppError.conflict(`This ticket is already ${result.reason}`);
  }
  const { ticket, events } = result;

  sendSuccess(res, "Support ticket resolved successfully", userTicketView(ticket));

  announceTicket(ticket, events);
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.resolve",
    description: `Marked support ticket ${ticket.code} as resolved`,
    targetId: ticket.id,
    after: ticketAuditView(ticket),
  });
}

export async function rateMyTicket(req: Request, res: Response) {
  const { userId } = raiser(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as RateTicketInput;

  await supportTicketModel.sweep({ id });
  const result = await supportTicketModel.rate(id, userId, input);
  if (!result.ok) {
    if (result.reason === "notFound") throw ticketNotFound(id);
    throw AppError.conflict(
      result.reason === "rated"
        ? "You have already rated this ticket"
        : "You can rate a ticket once it is resolved",
    );
  }
  const { ticket, events } = result;

  sendSuccess(res, "Support ticket rated successfully", userTicketView(ticket));

  announceTicket(ticket, events);
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.rate",
    description: `Rated support ticket ${ticket.code} ${ticket.rating} out of 5`,
    targetId: ticket.id,
    after: ticketAuditView(ticket),
    redact: REDACT,
  });
}

// Chat. The ticket must be the caller's own (and not detached): anyone else gets 404.
async function ownTicket(req: Request) {
  const { userId } = raiser(req);
  const { id } = req.validated.params as { id: string };
  const ticket = await supportTicketModel.findOwned(id, userId);
  if (!ticket) throw ticketNotFound(id);
  return { userId, ticket };
}

export async function listMyMessages(req: Request, res: Response) {
  const { ticket } = await ownTicket(req);
  const page = await supportMessageModel.listPage(ticket.id, true, req.validated.query as ListMessagesQuery);

  sendSuccess(res, "Messages retrieved successfully", {
    ...page,
    items: page.items.map(userMessageView),
    readMarkers: { user: ticket.userLastReadSeq, staff: ticket.staffLastReadSeq },
  });
}

export async function postMyMessage(req: Request, res: Response) {
  const { userId, ticket } = await ownTicket(req);
  const posted = await postTicketMessage(
    ticket,
    { side: "user", userId, userName: null, kind: "message" },
    req.validated.body as PostMessageInput,
    filesOf(req),
  );

  sendCreated(res, "Message sent successfully", {
    message: userMessageView(posted.message),
    ticket: userTicketView(posted.ticket),
  });

  announceMessage(posted.ticket, posted.message, posted.events);
}

export async function deleteMyMessage(req: Request, res: Response) {
  const { userId, ticket } = await ownTicket(req);
  const { messageId } = req.validated.params as { messageId: string };
  const message = await deleteTicketMessage(ticket, messageId, { userId, side: "user", canModerate: false });

  sendSuccess(res, "Message deleted successfully", userMessageView(message));

  logActivity(req, {
    ...MESSAGE_ACTIVITY,
    action: "support.message.delete",
    description: `Deleted a message on support ticket ${ticket.code}`,
    targetId: messageId,
  });
}

export async function readMyTicket(req: Request, res: Response) {
  const { userId, ticket } = await ownTicket(req);
  const lastReadSeq = (await supportTicketModel.markRead(ticket.id, "user", userId)) ?? 0;

  sendSuccess(res, "Ticket marked as read", { lastReadSeq });

  announceRead(ticket, "user", lastReadSeq);
}
