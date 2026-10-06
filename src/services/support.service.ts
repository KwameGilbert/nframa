import { deleteFile, uploadAttachment, type StoredAttachment } from "./storage.service.js";
import { emitToSupportDesk, emitToUser } from "./socket.service.js";
import { staffTicketView, userEventView, userTicketView } from "./supportViews.js";
import type { SupportTicket } from "../models/supportTicket.model.js";
import type { SupportMessage } from "../models/supportMessage.model.js";

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
