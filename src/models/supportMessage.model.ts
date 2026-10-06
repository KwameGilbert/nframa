import type { Knex } from "knex";
import type { StoredAttachment } from "../services/storage.service.js";

export type SenderSide = "user" | "staff" | "system";
export type SupportEventType =
  | "opened"
  | "statusChanged"
  | "assigned"
  | "unassigned"
  | "detailsChanged"
  | "rated";

export interface SupportMessage {
  id: string;
  ticketId: string;
  seq: number;
  senderUserId: string | null;
  senderSide: SenderSide;
  kind: "message" | "note" | "event";
  internal: boolean;
  body: string | null;
  attachments: StoredAttachment[];
  replyToMessageId: string | null;
  eventType: SupportEventType | null;
  eventData: Record<string, unknown> | null;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  deletedBySide: "user" | "staff" | null;
  createdAt: Date;
}

// Every column but the generated searchVector: queries list these, never m.*.
export const MESSAGE_VIEW_COLUMNS = [
  "id",
  "ticketId",
  "seq",
  "senderUserId",
  "senderSide",
  "kind",
  "internal",
  "body",
  "attachments",
  "replyToMessageId",
  "eventType",
  "eventData",
  "deletedAt",
  "deletedByUserId",
  "deletedBySide",
  "createdAt",
] as const;

export interface EventInput {
  ticketId: string;
  type: SupportEventType;
  side: SenderSide;
  userId: string | null;
  internal: boolean;
  data?: Record<string, unknown>;
}

export const supportMessageModel = {
  // Inside the caller's transaction, which holds the ticket's row lock, so seq follows commit order.
  async insertEventIn(trx: Knex.Transaction, event: EventInput): Promise<SupportMessage> {
    const [row] = await trx("supportTicketMessages")
      .insert({
        ticketId: event.ticketId,
        senderUserId: event.userId,
        senderSide: event.side,
        kind: "event",
        internal: event.internal,
        eventType: event.type,
        eventData: event.data ?? {},
      })
      .returning([...MESSAGE_VIEW_COLUMNS]);
    return row;
  },

  async insertMessageIn(
    trx: Knex.Transaction,
    message: {
      ticketId: string;
      side: "user" | "staff";
      userId: string;
      kind: "message" | "note";
      body: string | null;
      attachments: StoredAttachment[];
      replyToMessageId?: string | null;
    },
  ): Promise<SupportMessage> {
    const [row] = await trx("supportTicketMessages")
      .insert({
        ticketId: message.ticketId,
        senderUserId: message.userId,
        senderSide: message.side,
        kind: message.kind,
        internal: message.kind === "note",
        body: message.body,
        attachments: JSON.stringify(message.attachments),
        replyToMessageId: message.replyToMessageId ?? null,
      })
      .returning([...MESSAGE_VIEW_COLUMNS]);
    return row;
  },
};
