import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { supportTicketModel, type Outcome, type SupportTicket } from "../models/supportTicket.model.js";
import { userModel } from "../models/user.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { emitToSupportDesk, emitToUser } from "../services/socket.service.js";
import {
  announceTicket,
  discardAttachments,
  filesOf,
  storeAttachments,
} from "../services/support.service.js";
import {
  staffTicketDetailView,
  staffTicketView,
  ticketAuditView,
  userTicketView,
} from "../services/supportViews.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import { checkNewTicket, REDACT, TICKET_ACTIVITY, ticketNotFound } from "./support.controller.js";
import type {
  AdminCreateTicketInput,
  AdminListTicketsQuery,
  AssignTicketInput,
  UpdateTicketInput,
} from "../schemas/support.schema.js";

const adminIdOf = (req: Request) => req.auth!.id;

// A refused change: the ticket is gone, closed, or the change names something that can't be used.
function unwrap(id: string, outcome: Outcome<SupportTicket>) {
  if (outcome.ok) return outcome;
  if (outcome.reason === "notFound") throw ticketNotFound(id);
  if (outcome.reason === "closed") throw AppError.conflict("This ticket is closed");
  throw AppError.badRequest("That support category isn't available");
}

export async function adminListTickets(req: Request, res: Response) {
  const query = req.validated.query as AdminListTicketsQuery;
  const adminId = adminIdOf(req);

  await supportTicketModel.sweep({});
  const [{ items, totalItems }, stats] = await Promise.all([
    supportTicketModel.listForStaff(query, adminId),
    supportTicketModel.stats(adminId),
  ]);
  const activity = await supportTicketModel.activity(items, "staff");

  sendSuccess(res, "Support tickets retrieved successfully", {
    items: items.map((ticket) => staffTicketView(ticket, activity.get(ticket.id))),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
    stats,
  });
}

export async function adminGetTicket(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  await supportTicketModel.sweep({ id });
  const ticket = await supportTicketModel.findById(id);
  if (!ticket) throw ticketNotFound(id);
  const [activity, detail] = await Promise.all([
    supportTicketModel.activity([ticket], "staff"),
    supportTicketModel.staffDetail(ticket),
  ]);

  sendSuccess(res, "Support ticket retrieved successfully", staffTicketDetailView(ticket, activity.get(id), detail));

  // Reading a ticket shows a person's phone, email and conversation, so it is on the record.
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.view",
    description: `Viewed support ticket ${ticket.code}`,
    targetId: id,
  });
}

// Staff open a ticket for a rider or driver (e.g. after a phone call): it starts with them, in progress.
export async function adminCreateTicket(req: Request, res: Response) {
  const adminId = adminIdOf(req);
  const input = req.validated.body as AdminCreateTicketInput;
  const files = filesOf(req);

  const raiser = await userModel.findById(input.userId);
  if (!raiser || raiser.deletedAt) throw AppError.notFound(`User not found: ${input.userId}`);
  if (raiser.role !== "rider" && raiser.role !== "driver") {
    throw AppError.badRequest("Support tickets can only be opened for riders and drivers");
  }
  const category = await checkNewTicket(input, files, raiser.id, raiser.role);
  const admin = await userModel.findById(adminId);

  const id = randomUUID();
  const attachments = await storeAttachments(files, id);
  let created: Awaited<ReturnType<typeof supportTicketModel.create>>;
  try {
    created = await supportTicketModel.create({
      id,
      userId: raiser.id,
      raiserRole: raiser.role,
      categoryId: category.id,
      subject: input.subject,
      priority: input.priority ?? category.defaultPriority,
      tripId: input.tripId,
      transactionId: input.transactionId,
      payoutId: input.payoutId,
      relatedTicketId: input.relatedTicketId,
      body: input.message ?? null,
      attachments,
      onBehalf: { adminId, adminName: admin?.fullName ?? null },
    });
  } catch (err) {
    await discardAttachments(attachments);
    throw err;
  }
  const { ticket } = created;
  const activity = await supportTicketModel.activity([ticket], "staff");

  sendCreated(res, "Support ticket created successfully", staffTicketView(ticket, activity.get(id)));

  emitToSupportDesk("support:ticketCreated", { ticket: staffTicketView(ticket) });
  emitToUser(ticket.userId, "support:ticketCreated", { ticket: userTicketView(ticket) });
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.createOnBehalf",
    description: `Opened support ticket ${ticket.code} for a ${ticket.raiserRole}`,
    targetId: id,
    after: ticketAuditView(ticket),
    redact: REDACT,
  });
}

export async function adminUpdateTicket(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateTicketInput;

  await supportTicketModel.sweep({ id });
  const before = await supportTicketModel.findById(id);
  if (!before) throw ticketNotFound(id);
  const { ticket, events } = unwrap(id, await supportTicketModel.changeByStaff(id, adminIdOf(req), input));

  sendSuccess(res, "Support ticket updated successfully", staffTicketView(ticket));

  if (events.length === 0) return;
  announceTicket(ticket, events);
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.update",
    description: `Updated support ticket ${ticket.code}`,
    targetId: id,
    before: ticketAuditView(before),
    after: ticketAuditView(ticket),
    redact: REDACT,
  });
}

export async function assignTicket(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { adminId: requested } = (req.validated.body ?? {}) as AssignTicketInput;
  const adminId = adminIdOf(req);
  const targetId = requested ?? adminId;

  const eligible = await rolePermissionModel.adminUserIdsWithPermission("support", "update");
  if (!eligible.includes(targetId)) {
    throw AppError.badRequest(
      requested ? "That admin can't take support tickets" : "You can't take support tickets",
    );
  }
  const target = await userModel.findById(targetId);

  await supportTicketModel.sweep({ id });
  const { ticket, events } = unwrap(
    id,
    await supportTicketModel.assign(id, adminId, { id: targetId, fullName: target?.fullName ?? null }),
  );

  sendSuccess(res, "Support ticket assigned successfully", staffTicketView(ticket));

  if (events.length === 0) return;
  announceTicket(ticket, events);
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.assign",
    description:
      targetId === adminId
        ? `Took support ticket ${ticket.code}`
        : `Assigned support ticket ${ticket.code} to another agent`,
    targetId: id,
    after: ticketAuditView(ticket),
  });
}

export async function unassignTicket(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  await supportTicketModel.sweep({ id });
  const { ticket, events } = unwrap(id, await supportTicketModel.unassign(id, adminIdOf(req)));

  sendSuccess(res, "Support ticket unassigned successfully", staffTicketView(ticket));

  if (events.length === 0) return;
  announceTicket(ticket, events);
  logActivity(req, {
    ...TICKET_ACTIVITY,
    action: "support.ticket.unassign",
    description: `Unassigned support ticket ${ticket.code}`,
    targetId: id,
    after: ticketAuditView(ticket),
  });
}

export async function listAssignees(_req: Request, res: Response) {
  const ids = await rolePermissionModel.adminUserIdsWithPermission("support", "update");
  sendSuccess(res, "Support agents retrieved successfully", await supportTicketModel.assignees(ids));
}
