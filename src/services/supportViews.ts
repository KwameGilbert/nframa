import type { StoredAttachment } from "./storage.service.js";
import type {
  supportTicketModel,
  SupportTicket,
  TicketActivity,
} from "../models/supportTicket.model.js";
import type { MessageRow } from "../models/supportMessage.model.js";

const PREVIEW_LENGTH = 120;
const DAY = 86_400_000;

// Where a file lives in storage is the server's business alone.
export function attachmentView(attachment: StoredAttachment) {
  const {
    id,
    kind,
    fileUrl,
    thumbnailUrl,
    mimeType,
    fileName,
    sizeBytes,
    durationSeconds,
    width,
    height,
  } = attachment;
  return {
    id,
    kind,
    fileUrl,
    thumbnailUrl,
    mimeType,
    fileName,
    sizeBytes,
    durationSeconds,
    width,
    height,
  };
}

function lastMessageView(last: TicketActivity["lastMessage"]) {
  if (!last) return null;
  const deleted = last.deletedAt !== null;
  return {
    id: last.id,
    from: last.senderSide === "user" ? ("user" as const) : ("support" as const),
    preview: deleted || !last.body ? null : last.body.slice(0, PREVIEW_LENGTH),
    attachmentKind: deleted ? null : (last.attachments[0]?.kind ?? null),
    deleted,
    createdAt: last.createdAt,
  };
}

// What the raiser sees of their ticket: never its priority, who it's assigned to, who opened it for them, or
// whether it was detached.
export function userTicketView(ticket: SupportTicket, activity?: TicketActivity) {
  return {
    id: ticket.id,
    code: ticket.code,
    subject: ticket.subject,
    status: ticket.status,
    category: { id: ticket.categoryId, name: ticket.categoryName },
    tripId: ticket.tripId,
    transactionId: ticket.transactionId,
    payoutId: ticket.payoutId,
    relatedTicketId: ticket.relatedTicketId,
    lastMessageAt: ticket.lastMessageAt,
    unreadCount: activity?.unreadCount ?? 0,
    lastMessage: lastMessageView(activity?.lastMessage ?? null),
    rating: ticket.rating,
    ratingComment: ticket.ratingComment,
    ratedAt: ticket.ratedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function userTicketDetailView(
  ticket: SupportTicket,
  activity: TicketActivity | undefined,
  reopenWindowDays: number,
) {
  return {
    ...userTicketView(ticket, activity),
    canReply: ticket.status !== "closed",
    reopenUntil:
      ticket.status === "resolved" && ticket.resolvedAt
        ? new Date(new Date(ticket.resolvedAt).getTime() + reopenWindowDays * DAY)
        : null,
  };
}

// The audit trail keeps ids, the code and the state: never the subject or what anyone wrote.
export function ticketAuditView(ticket: SupportTicket) {
  return {
    id: ticket.id,
    code: ticket.code,
    status: ticket.status,
    priority: ticket.priority,
    categoryId: ticket.categoryId,
    assignedAdminId: ticket.assignedAdminId,
    rating: ticket.rating,
  };
}

// Events as the raiser sees them: public ones only, and only what changed, never who did it.
export function userEventView(event: {
  id: string;
  seq: number;
  eventType: string | null;
  eventData: Record<string, unknown> | null;
  internal: boolean;
  createdAt: Date;
}) {
  const data = event.eventData ?? {};
  const visible = Object.fromEntries(
    ["from", "to", "reason", "rating"].filter((key) => key in data).map((key) => [key, data[key]]),
  );
  return {
    id: event.id,
    seq: event.seq,
    type: event.eventType,
    data: visible,
    createdAt: event.createdAt,
  };
}

const person = (id: string | null, fullName: string | null) => (id ? { id, fullName } : null);

// Staff see everything about a ticket except where its files are stored.
export function staffTicketView(ticket: SupportTicket, activity?: TicketActivity) {
  return {
    id: ticket.id,
    code: ticket.code,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    category: { id: ticket.categoryId, name: ticket.categoryName },
    raiser: { id: ticket.userId, fullName: ticket.raiserName, role: ticket.raiserRole },
    assignee: person(ticket.assignedAdminId, ticket.assigneeName),
    assignedAt: ticket.assignedAt,
    createdBy: person(ticket.createdByAdminId, ticket.createdByName),
    tripId: ticket.tripId,
    transactionId: ticket.transactionId,
    payoutId: ticket.payoutId,
    relatedTicketId: ticket.relatedTicketId,
    firstResponseAt: ticket.firstResponseAt,
    lastMessageAt: ticket.lastMessageAt,
    lastMessageSide: ticket.lastMessageSide,
    unreadCount: activity?.unreadCount ?? 0,
    lastMessage: lastMessageView(activity?.lastMessage ?? null),
    rating: ticket.rating,
    ratingComment: ticket.ratingComment,
    ratedAt: ticket.ratedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    detachedAt: ticket.detachedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

type StaffDetail = Awaited<ReturnType<typeof supportTicketModel.staffDetail>>;

export function staffTicketDetailView(
  ticket: SupportTicket,
  activity: TicketActivity | undefined,
  detail: StaffDetail,
) {
  const { raiser, trip, transaction, payout, relatedTicket, history } = detail;
  return {
    ...staffTicketView(ticket, activity),
    raiser: {
      id: ticket.userId,
      fullName: raiser?.fullName ?? null,
      role: ticket.raiserRole,
      phoneNumber: raiser?.phoneNumber
        ? `${raiser.phoneCountryCode ?? ""}${raiser.phoneNumber}`
        : null,
      email: raiser?.email ?? null,
      status: raiser?.status ?? "unknown",
      deleted: Boolean(raiser?.deletedAt),
    },
    trip: trip ? { ...trip, totalAmount: Number(trip.totalAmount) } : null,
    transaction: transaction ? { ...transaction, amount: Number(transaction.amount) } : null,
    payout: payout ? { ...payout, amount: Number(payout.amount) } : null,
    relatedTicket: relatedTicket ?? null,
    history,
  };
}

const SIDE_LABEL = { user: "user", staff: "support", system: "system" } as const;
export const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

function messageBase(m: MessageRow) {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    seq: m.seq,
    kind: m.kind,
    from: SIDE_LABEL[m.senderSide],
    replyToMessageId: m.replyToMessageId,
    deleted,
    removedBy: deleted
      ? m.deletedBySide === "user"
        ? ("user" as const)
        : ("support" as const)
      : null,
    createdAt: m.createdAt,
  };
}

// A user sees agents by first name, events without who did them, and a deleted message as just "deleted".
export function userMessageView(m: MessageRow) {
  const base = messageBase(m);
  const { type, data } = userEventView(m);
  return {
    ...base,
    senderName: base.from === "support" && m.kind !== "event" ? firstName(m.senderName) : null,
    body: base.deleted ? null : m.body,
    attachments: base.deleted ? [] : m.attachments.map(attachmentView),
    event: m.kind === "event" ? { type, data } : null,
  };
}

// Staff keep everything, deleted originals included (flagged), except where files are stored.
export function staffMessageView(m: MessageRow) {
  return {
    ...messageBase(m),
    internal: m.internal,
    senderName: m.senderName,
    body: m.body,
    attachments: m.attachments.map(attachmentView),
    event: m.kind === "event" ? { type: m.eventType, data: m.eventData ?? {} } : null,
  };
}
