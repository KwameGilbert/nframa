import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { settingModel } from "../models/setting.model.js";
import { supportCategoryModel } from "../models/supportCategory.model.js";
import { LINKS, supportTicketModel, type SupportTicket } from "../models/supportTicket.model.js";
import type { SupportMessage } from "../models/supportMessage.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { emitToSupportDesk, emitToUser } from "../services/socket.service.js";
import { discardAttachments, filesOf, storeAttachments } from "../services/support.service.js";
import {
  ticketAuditView,
  userEventView,
  userTicketDetailView,
  userTicketView,
} from "../services/supportViews.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateTicketInput,
  ListMyTicketsQuery,
  RateTicketInput,
} from "../schemas/support.schema.js";

const TICKET_ACTIVITY = { module: "support", targetType: "supportTicket" } as const;
const REDACT = ["subject", "message", "body", "comment"];

function raiser(req: Request): { userId: string; role: "rider" | "driver" } {
  const role = req.auth?.role;
  if (role !== "rider" && role !== "driver") {
    throw AppError.forbidden("Only riders and drivers can use support tickets");
  }
  return { userId: req.auth!.id, role };
}

export const ticketNotFound = (id: string) => AppError.notFound(`Support ticket not found: ${id}`);

// What every staff screen and the raiser's other devices learn when a ticket changes.
function announce(ticket: SupportTicket, events: SupportMessage[]) {
  emitToSupportDesk("support:ticketUpdated", { ticket, events });
  emitToUser(ticket.userId, "support:ticketUpdated", {
    ticket: userTicketView(ticket),
    events: events.filter((e) => !e.internal).map(userEventView),
  });
}

export async function createTicket(req: Request, res: Response) {
  const { userId, role } = raiser(req);
  const input = req.validated.body as CreateTicketInput;
  const files = filesOf(req);

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
  const activity = await supportTicketModel.userActivity([ticket]);

  sendCreated(res, "Support ticket created successfully", userTicketView(ticket, activity.get(ticket.id)));

  emitToSupportDesk("support:ticketCreated", { ticket });
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
  const activity = await supportTicketModel.userActivity(items);

  sendSuccess(res, "Support tickets retrieved successfully", {
    items: items.map((ticket) => userTicketView(ticket, activity.get(ticket.id))),
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
    supportTicketModel.userActivity([ticket]),
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

  announce(ticket, events);
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

  announce(ticket, events);
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.rate",
    description: `Rated support ticket ${ticket.code} ${ticket.rating} out of 5`,
    targetId: ticket.id,
    after: ticketAuditView(ticket),
    redact: REDACT,
  });
}
