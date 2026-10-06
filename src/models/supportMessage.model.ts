import type { Knex } from "knex";
import db from "../database/knex.js";
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

export type MessageRow = SupportMessage & { senderName: string | null };

export interface PageQuery {
  before?: number;
  after?: number;
  around?: number;
  limit: number;
  attachmentKind?: string;
}

// A ticket's timeline as one viewer may see it: users never see notes or internal events.
function timeline(ticketId: string, publicOnly: boolean, attachmentKind?: string) {
  const query = db("supportTicketMessages as m").where("m.ticketId", ticketId);
  if (publicOnly) query.where("m.internal", false);
  if (attachmentKind) {
    query.whereNot("m.kind", "event").whereRaw(`m.attachments @> ?::jsonb`, [JSON.stringify([{ kind: attachmentKind }])]);
  }
  return query;
}

export const supportMessageModel = {
  // One page of the timeline, oldest first, by seq cursor. No cursor: the latest page.
  async listPage(ticketId: string, publicOnly: boolean, q: PageQuery) {
    const rows = () =>
      timeline(ticketId, publicOnly, q.attachmentKind)
        .leftJoin("users as u", "u.id", "m.senderUserId")
        .select(...MESSAGE_VIEW_COLUMNS.map((c) => `m.${c}`), "u.fullName as senderName");
    const older = (below: number | null, n: number) =>
      (below === null ? rows() : rows().where("m.seq", "<", below)).orderBy("m.seq", "desc").limit(n);
    const newer = (from: number, n: number, inclusive = false) =>
      rows().where("m.seq", inclusive ? ">=" : ">", from).orderBy("m.seq", "asc").limit(n);

    let items: MessageRow[];
    if (q.after !== undefined) items = await newer(q.after, q.limit);
    else if (q.around !== undefined) {
      const half = Math.floor(q.limit / 2);
      const [before, rest] = await Promise.all([older(q.around, half), newer(q.around, q.limit - half, true)]);
      items = [...before.reverse(), ...rest];
    } else items = (await older(q.before ?? null, q.limit)).reverse();

    const exists = (op: "<" | ">", seq: number) =>
      timeline(ticketId, publicOnly, q.attachmentKind).where("m.seq", op, seq).first("m.id");
    const [first, last] = [items[0], items.at(-1)];
    const [before, after] = await Promise.all([
      first ? exists("<", first.seq) : undefined,
      last ? exists(">", last.seq) : undefined,
    ]);
    return { items, hasMoreBefore: Boolean(before), hasMoreAfter: Boolean(after) };
  },

  // Row-locked so two deletes (or a delete and a moderation removal) can't both go through. Keeps the body and
  // files: staff still see them as evidence.
  async softDelete(
    ticketId: string,
    messageId: string,
    actor: { userId: string; side: "user" | "staff"; canModerate: boolean; windowMinutes: number },
  ): Promise<{ ok: true; message: SupportMessage } | { ok: false; reason: "notFound" | "deleted" | "notYours" | "window" }> {
    return db.transaction(async (trx) => {
      const message = await trx("supportTicketMessages")
        .where({ id: messageId, ticketId })
        .whereNot("kind", "event")
        .forNoKeyUpdate()
        .first<SupportMessage | undefined>(MESSAGE_VIEW_COLUMNS);
      if (!message || (actor.side === "user" && message.internal)) return { ok: false, reason: "notFound" };
      if (message.deletedAt) return { ok: false, reason: "deleted" };
      const own = message.senderUserId === actor.userId && message.senderSide === actor.side;
      const fresh = Date.now() - new Date(message.createdAt).getTime() <= actor.windowMinutes * 60_000;
      if (!actor.canModerate) {
        if (!own) return { ok: false, reason: "notYours" };
        if (!fresh) return { ok: false, reason: "window" };
      }

      const [deleted] = await trx("supportTicketMessages")
        .where({ id: messageId })
        .update({ deletedAt: trx.fn.now(), deletedByUserId: actor.userId, deletedBySide: actor.side })
        .returning([...MESSAGE_VIEW_COLUMNS]);
      return { ok: true, message: deleted };
    });
  },
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
