import type { Knex } from "knex";
import db from "../database/knex.js";
import { generateCode } from "../utils/code.js";
import { isUniqueViolation } from "../utils/dbErrors.js";
import { settingModel } from "./setting.model.js";
import { supportMessageModel, type SupportMessage } from "./supportMessage.model.js";
import type { StoredAttachment } from "../services/storage.service.js";
import type { SupportPriority } from "../schemas/supportCategory.schema.js";
import {
  ACTIVE_SUPPORT_STATUSES,
  type ListMyTicketsQuery,
  type SupportStatus,
} from "../schemas/support.schema.js";

export interface SupportTicket {
  id: string;
  code: string;
  userId: string;
  raiserRole: "rider" | "driver";
  categoryId: string;
  categoryName: string;
  subject: string;
  priority: SupportPriority;
  status: SupportStatus;
  assignedAdminId: string | null;
  createdByAdminId: string | null;
  assignedAt: Date | null;
  tripId: string | null;
  transactionId: string | null;
  payoutId: string | null;
  relatedTicketId: string | null;
  firstResponseAt: Date | null;
  lastMessageAt: Date;
  lastMessageSide: "user" | "staff" | null;
  userLastReadSeq: number | null;
  staffLastReadSeq: number | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  rating: number | null;
  ratingComment: string | null;
  ratedAt: Date | null;
  detachedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketActivity {
  unreadCount: number;
  lastMessage: Pick<
    SupportMessage,
    "id" | "senderSide" | "body" | "attachments" | "deletedAt" | "createdAt"
  > | null;
}

export type SweepScope = { id: string } | { userId: string } | Record<string, never>;

export type Refusal<T> = { ok: true; ticket: T; events: SupportMessage[] } | { ok: false; reason: string };

const TICKET_COLUMNS = ["t.*", "c.name as categoryName"];

export const LINKS = {
  tripId: { table: "trips", owner: ["riderUserId", "driverUserId"], label: "Trip" },
  transactionId: { table: "transactions", owner: ["userId"], label: "Transaction" },
  payoutId: { table: "payoutHistory", owner: ["driverUserId"], label: "Payout" },
  relatedTicketId: { table: "supportTickets", owner: ["userId"], label: "Support ticket" },
} as const;

function withCategory(query = db("supportTickets as t")) {
  return query.join("supportCategories as c", "c.id", "t.categoryId").select(TICKET_COLUMNS);
}

function scopeSql(scope: SweepScope): { sql: string; bindings: string[] } {
  if ("id" in scope) return { sql: `AND "id" = ?`, bindings: [scope.id as string] };
  if ("userId" in scope) return { sql: `AND "userId" = ?`, bindings: [scope.userId as string] };
  return { sql: "", bindings: [] };
}

// Locks the ticket for the rest of the transaction: every message and event insert on a ticket holds this lock,
// so seq follows commit order and two writers can't both act on the same status.
async function lockOwned(trx: Knex.Transaction, id: string, userId: string) {
  return trx("supportTickets")
    .where({ id, userId })
    .whereNull("detachedAt")
    .forUpdate()
    .first<{ id: string; status: SupportStatus; ratedAt: Date | null } | undefined>();
}

export interface CreateTicketData {
  id: string;
  userId: string;
  raiserRole: "rider" | "driver";
  categoryId: string;
  subject: string;
  priority: SupportPriority;
  tripId?: string;
  transactionId?: string;
  payoutId?: string;
  relatedTicketId?: string;
  body: string | null;
  attachments: StoredAttachment[];
}

export const supportTicketModel = {
  // The ticket, its "opened" event and the first message, all or nothing. The random code can collide; the whole
  // transaction is retried with a new one.
  async create(data: CreateTicketData): Promise<{ ticket: SupportTicket; events: SupportMessage[] }> {
    const { body, attachments, ...ticket } = data;
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction(async (trx) => {
          await trx("supportTickets").insert({ ...ticket, code: generateCode("ST") });
          const opened = await supportMessageModel.insertEventIn(trx, {
            ticketId: ticket.id,
            type: "opened",
            side: "user",
            userId: ticket.userId,
            internal: false,
          });
          const first =
            body || attachments.length > 0
              ? await supportMessageModel.insertMessageIn(trx, {
                  ticketId: ticket.id,
                  side: "user",
                  userId: ticket.userId,
                  kind: "message",
                  body,
                  attachments,
                })
              : undefined;
          await trx("supportTickets")
            .where({ id: ticket.id })
            .update({
              lastMessageAt: (first ?? opened).createdAt,
              lastMessageSide: first ? "user" : null,
              userLastReadSeq: (first ?? opened).seq,
            });
          return {
            ticket: (await withCategory(trx("supportTickets as t")).where("t.id", ticket.id).first()) as SupportTicket,
            events: [opened],
          };
        });
      } catch (err) {
        if (isUniqueViolation(err, "supportTickets_code_unique") && attempt < 3) continue;
        throw err;
      }
    }
  },

  // A record a ticket links to must be the raiser's own.
  async ownsLink(link: keyof typeof LINKS, id: string, userId: string): Promise<boolean> {
    const { table, owner } = LINKS[link];
    const query = db(table).where({ id }).andWhere((q) => {
      for (const column of owner) q.orWhere(column, userId);
    });
    if (link === "relatedTicketId") query.whereNull("detachedAt");
    return Boolean(await query.first("id"));
  },

  findOwned(id: string, userId: string): Promise<SupportTicket | undefined> {
    return withCategory().where({ "t.id": id, "t.userId": userId }).whereNull("t.detachedAt").first();
  },

  findById(id: string): Promise<SupportTicket | undefined> {
    return withCategory().where("t.id", id).first();
  },

  async listForUser(userId: string, query: ListMyTicketsQuery) {
    const base = db("supportTickets as t").where("t.userId", userId).whereNull("t.detachedAt");
    if (query.status) base.whereIn("t.status", query.status);
    if (query.tripId) base.where("t.tripId", query.tripId);

    const [items, [{ count }]] = await Promise.all([
      withCategory(base.clone())
        .orderBy([
          { column: "t.lastMessageAt", order: "desc" },
          { column: "t.id", order: "asc" },
        ])
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      base.clone().count<{ count: string }[]>("* as count"),
    ]);
    return { items: items as SupportTicket[], totalItems: Number(count) };
  },

  // For a user's ticket list: support messages they haven't read and the last public message. Notes and
  // internal events never count.
  async userActivity(tickets: Pick<SupportTicket, "id">[]): Promise<Map<string, TicketActivity>> {
    const ids = tickets.map((t) => t.id);
    const activity = new Map<string, TicketActivity>(
      ids.map((id) => [id, { unreadCount: 0, lastMessage: null }]),
    );
    if (ids.length === 0) return activity;

    const [unread, last] = await Promise.all([
      db("supportTicketMessages as m")
        .join("supportTickets as t", "t.id", "m.ticketId")
        .whereIn("m.ticketId", ids)
        .where({ "m.kind": "message", "m.internal": false, "m.senderSide": "staff" })
        .whereNull("m.deletedAt")
        .whereRaw(`m.seq > coalesce(t."userLastReadSeq", 0)`)
        .groupBy("m.ticketId")
        .select("m.ticketId")
        .count<{ ticketId: string; count: string }[]>("* as count"),
      db("supportTicketMessages")
        .distinctOn("ticketId")
        .whereIn("ticketId", ids)
        .where({ kind: "message", internal: false })
        .orderBy([
          { column: "ticketId" },
          { column: "seq", order: "desc" },
        ])
        .select("id", "ticketId", "senderSide", "body", "attachments", "deletedAt", "createdAt"),
    ]);
    for (const row of unread) activity.get(row.ticketId)!.unreadCount = Number(row.count);
    for (const row of last) activity.get(row.ticketId)!.lastMessage = row;
    return activity;
  },

  // The lazy sweeps (no cron): a ticket waiting on the user past support.autoResolveDays resolves, and one resolved
  // past support.reopenWindowDays closes. Run before anything reads or writes tickets. Each rule is one statement,
  // the status change and its timeline event together.
  async sweep(scope: SweepScope, trx: Knex | Knex.Transaction = db): Promise<void> {
    const settings = await settingModel.getValues(["support.autoResolveDays", "support.reopenWindowDays"]);
    const { sql, bindings } = scopeSql(scope);

    await trx.raw(
      `WITH changed AS (
         UPDATE "supportTickets" SET "status" = 'resolved', "resolvedAt" = now(), "updatedAt" = now()
         WHERE "status" = 'awaitingUser' AND "lastMessageAt" <= now() - (? * interval '1 day') ${sql}
         RETURNING "id"
       )
       INSERT INTO "supportTicketMessages" ("ticketId", "senderSide", "kind", "internal", "eventType", "eventData")
       SELECT "id", 'system', 'event', false, 'statusChanged',
              '{"from": "awaitingUser", "to": "resolved", "reason": "autoResolved"}'::jsonb
       FROM changed`,
      [settings["support.autoResolveDays"], ...bindings],
    );
    await trx.raw(
      `WITH changed AS (
         UPDATE "supportTickets" SET "status" = 'closed', "closedAt" = now(), "updatedAt" = now()
         WHERE "status" = 'resolved' AND "resolvedAt" <= now() - (? * interval '1 day') ${sql}
         RETURNING "id"
       )
       INSERT INTO "supportTicketMessages" ("ticketId", "senderSide", "kind", "internal", "eventType", "eventData")
       SELECT "id", 'system', 'event', false, 'statusChanged',
              '{"from": "resolved", "to": "closed", "reason": "reopenWindowExpired"}'::jsonb
       FROM changed`,
      [settings["support.reopenWindowDays"], ...bindings],
    );
  },

  async resolveByUser(id: string, userId: string): Promise<Refusal<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lockOwned(trx, id, userId);
      if (!locked) return { ok: false, reason: "notFound" };
      if (!ACTIVE_SUPPORT_STATUSES.includes(locked.status)) return { ok: false, reason: locked.status };

      await trx("supportTickets")
        .where({ id })
        .update({ status: "resolved", resolvedAt: trx.fn.now(), updatedAt: trx.fn.now() });
      const event = await supportMessageModel.insertEventIn(trx, {
        ticketId: id,
        type: "statusChanged",
        side: "user",
        userId,
        internal: false,
        data: { from: locked.status, to: "resolved", reason: "userResolved" },
      });
      const ticket = (await withCategory(trx("supportTickets as t")).where("t.id", id).first()) as SupportTicket;
      return { ok: true, ticket, events: [event] };
    });
  },

  async rate(
    id: string,
    userId: string,
    { rating, comment }: { rating: number; comment?: string },
  ): Promise<Refusal<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lockOwned(trx, id, userId);
      if (!locked) return { ok: false, reason: "notFound" };
      if (locked.status !== "resolved" && locked.status !== "closed") return { ok: false, reason: "notResolved" };
      if (locked.ratedAt) return { ok: false, reason: "rated" };

      await trx("supportTickets")
        .where({ id })
        .update({ rating, ratingComment: comment ?? null, ratedAt: trx.fn.now(), updatedAt: trx.fn.now() });
      const event = await supportMessageModel.insertEventIn(trx, {
        ticketId: id,
        type: "rated",
        side: "user",
        userId,
        internal: false,
        data: { rating },
      });
      const ticket = (await withCategory(trx("supportTickets as t")).where("t.id", id).first()) as SupportTicket;
      return { ok: true, ticket, events: [event] };
    });
  },

  // A recycled phone number: the account's new owner must never see the old owner's tickets. Staff still can.
  async detachForUser(userId: string, trx: Knex.Transaction): Promise<void> {
    await trx("supportTickets")
      .where({ userId })
      .whereNull("detachedAt")
      .update({
        detachedAt: trx.fn.now(),
        status: "closed",
        closedAt: trx.raw(`coalesce("closedAt", now())`),
        updatedAt: trx.fn.now(),
      });
  },
};
