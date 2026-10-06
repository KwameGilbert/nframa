import { deleteFile, uploadAttachment, type StoredAttachment } from "./storage.service.js";
import { emitToSupportDesk, emitToUser } from "./socket.service.js";
import {
  staffMessageView,
  staffTicketView,
  userEventView,
  userMessageView,
  userTicketView,
} from "./supportViews.js";
import { MESSAGE_DELETE_WINDOW_MINUTES } from "../config/supportAttachments.js";
import { supportTicketModel, type SupportTicket } from "../models/supportTicket.model.js";
import {
  supportMessageModel,
  type MessageRow,
  type SupportMessage,
} from "../models/supportMessage.model.js";
import type { PostMessageInput } from "../schemas/support.schema.js";
import { AppError } from "../utils/AppError.js";
import { notifySupport } from "./notificationEvents.service.js";

// After a change commits: the desk gets the staff view and every event, the raiser's devices the user view and only
// the public events. Nothing is sent to the raiser of a detached ticket (the number has a new owner).
export function announceTicket(ticket: SupportTicket, events: SupportMessage[]) {
  emitToSupportDesk("support:ticketUpdated", { ticket: staffTicketView(ticket), events });
  if (ticket.detachedAt) return;
  emitToUser(ticket.userId, "support:ticketUpdated", {
    ticket: userTicketView(ticket),
    events: events.filter((e) => !e.internal).map(userEventView),
  });
}

// Uploads a message's files (parsed to temp files by uploadAttachments) under the ticket's folder. Runs before the
// transaction, never inside it; if any upload fails, the ones that worked are deleted again.
export async function storeAttachments(
  files: Express.Multer.File[],
  ticketId: string,
): Promise<StoredAttachment[]> {
  const results = await Promise.allSettled(
    files.map((file) =>
      uploadAttachment(file.path, `support/${ticketId}`, {
        mimeType: file.mimetype,
        fileName: file.originalname,
        sizeBytes: file.size,
      }),
    ),
  );
  const stored = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) {
    await discardAttachments(stored);
    throw failed.reason;
  }
  return stored;
}

// For a write that rolled back or was refused after its files went up.
export async function discardAttachments(attachments: StoredAttachment[]): Promise<void> {
  await Promise.allSettled(attachments.map((a) => deleteFile(a.storageKey, a.resourceType)));
}

export function filesOf(req: { files?: unknown }): Express.Multer.File[] {
  return (req.files as Express.Multer.File[] | undefined) ?? [];
}

export const ticketNotFound = (id: string) => AppError.notFound(`Support ticket not found: ${id}`);

const REFUSALS: Record<string, () => AppError> = {
  closed: () => AppError.conflict("This ticket is closed. Open a new ticket and link it with relatedTicketId"),
  badReply: () => AppError.badRequest("You can only reply to a message on this ticket"),
};

// Posting to a ticket the caller can already see (checked unlocked first, so a refused post never uploads): files
// go up, then the locked write; files are deleted again if it fails or is refused.
export async function postTicketMessage(
  ticket: SupportTicket,
  post: { side: "user" | "staff"; userId: string; userName: string | null; kind: "message" | "note" },
  input: PostMessageInput,
  files: Express.Multer.File[],
) {
  if (ticket.status === "closed" && post.kind === "message") throw REFUSALS.closed();
  if (!input.body && files.length === 0) throw AppError.badRequest("Write a message or attach a file");

  const attachments = await storeAttachments(files, ticket.id);
  let outcome: Awaited<ReturnType<typeof supportTicketModel.postMessage>>;
  try {
    outcome = await supportTicketModel.postMessage({
      ticketId: ticket.id,
      ...post,
      body: input.body ?? null,
      attachments,
      replyToMessageId: input.replyToMessageId,
    });
  } catch (err) {
    await discardAttachments(attachments);
    throw err;
  }
  if (!outcome.ok) {
    await discardAttachments(attachments);
    throw (REFUSALS[outcome.reason] ?? (() => ticketNotFound(ticket.id)))();
  }
  const senderName = post.side === "staff" ? post.userName : outcome.ticket.raiserName;
  return {
    ticket: outcome.ticket,
    events: outcome.events,
    message: { ...outcome.message!, senderName } as MessageRow,
    firstUnread: outcome.firstUnread ?? false,
  };
}

// The raiser hears about public messages only, and nothing once the ticket is detached.
function toRaiser(ticket: SupportTicket, message: SupportMessage) {
  return !message.internal && !ticket.detachedAt;
}

export type PostedMessage = Awaited<ReturnType<typeof postTicketMessage>>;

// After a post commits: live events to both sides, and a push for the first unread message of a run (to the raiser
// for a staff reply, to the assignee for a user reply). Never to the raiser of a detached ticket.
export function announceMessage({ ticket, message, events, firstUnread }: PostedMessage) {
  emitToSupportDesk("support:message", {
    ticketId: ticket.id,
    message: staffMessageView(message),
    ticket: staffTicketView(ticket),
  });
  if (toRaiser(ticket, message)) {
    emitToUser(ticket.userId, "support:message", {
      ticketId: ticket.id,
      message: userMessageView(message),
      ticket: userTicketView(ticket),
    });
  }
  if (events.length > 0) announceTicket(ticket, events);
  if (!firstUnread || message.kind !== "message" || ticket.detachedAt) return;
  if (message.senderSide === "staff") void notifySupport(ticket.userId, "reply", ticket);
  else if (ticket.assignedAdminId) void notifySupport(ticket.assignedAdminId, "userReplied", ticket);
}

export async function deleteTicketMessage(
  ticket: SupportTicket,
  messageId: string,
  actor: { userId: string; side: "user" | "staff"; canModerate: boolean },
) {
  const outcome = await supportMessageModel.softDelete(ticket.id, messageId, {
    ...actor,
    windowMinutes: MESSAGE_DELETE_WINDOW_MINUTES,
  });
  if (!outcome.ok) {
    if (outcome.reason === "deleted") throw AppError.conflict("This message is already deleted");
    if (outcome.reason === "notYours") throw AppError.forbidden("You can only delete your own messages");
    if (outcome.reason === "window") {
      throw AppError.conflict(`Messages can only be deleted within ${MESSAGE_DELETE_WINDOW_MINUTES} minutes of sending`);
    }
    throw AppError.notFound(`Message not found: ${messageId}`);
  }
  const message = { ...outcome.message, senderName: null };
  emitToSupportDesk("support:messageDeleted", { ticketId: ticket.id, messageId });
  if (toRaiser(ticket, message)) {
    emitToUser(ticket.userId, "support:messageDeleted", { ticketId: ticket.id, messageId });
  }
  return message;
}

export function announceRead(ticket: SupportTicket, side: "user" | "staff", lastReadSeq: number) {
  const payload = { ticketId: ticket.id, side, lastReadSeq };
  emitToSupportDesk("support:read", payload);
  if (!ticket.detachedAt) emitToUser(ticket.userId, "support:read", payload);
}
