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
  type AdminListTicketsQuery,
  type ListMyTicketsQuery,
  type SupportStatus,
  type UpdateTicketInput,
} from "../schemas/support.schema.js";

export interface SupportTicket {
  id: string;
  code: string;
  userId: string;
  raiserRole: "rider" | "driver";
  categoryId: string;
  categoryName: string;
  raiserName: string | null;
  assigneeName: string | null;
  createdByName: string | null;
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

export type Viewer = "user" | "staff";

export interface TicketActivity {
  unreadCount: number;
  lastMessage: Pick<
    SupportMessage,
    "id" | "senderSide" | "kind" | "body" | "attachments" | "deletedAt" | "createdAt"
  > | null;
}

export type SweepScope = { id: string } | { userId: string } | Record<string, never>;

export type Outcome<T> = { ok: true; ticket: T; events: SupportMessage[] } | { ok: false; reason: string };

export const LINKS = {
  tripId: { table: "trips", owner: ["riderUserId", "driverUserId"], label: "Trip" },
  transactionId: { table: "transactions", owner: ["userId"], label: "Transaction" },
  payoutId: { table: "payoutHistory", owner: ["driverUserId"], label: "Payout" },
  relatedTicketId: { table: "supportTickets", owner: ["userId"], label: "Support ticket" },
} as const;

const ACTIVE_SQL = `('open', 'inProgress', 'awaitingUser')`;

// Every ticket query: the category's name and the names of the people on it.
function withNames(query: Knex.QueryBuilder = db("supportTickets as t")) {
  return query
    .join("supportCategories as c", "c.id", "t.categoryId")
    .join("users as u", "u.id", "t.userId")
    .leftJoin("users as a", "a.id", "t.assignedAdminId")
    .leftJoin("users as cb", "cb.id", "t.createdByAdminId")
    .select(
      "t.*",
      "c.name as categoryName",
      "u.fullName as raiserName",
      "a.fullName as assigneeName",
      "cb.fullName as createdByName",
    );
}

const reload = (trx: Knex | Knex.Transaction, id: string) =>
  withNames(trx("supportTickets as t")).where("t.id", id).first() as Promise<SupportTicket>;

function scopeSql(scope: SweepScope): { sql: string; bindings: string[] } {
  if ("id" in scope) return { sql: `AND "id" = ?`, bindings: [scope.id as string] };
  if ("userId" in scope) return { sql: `AND "userId" = ?`, bindings: [scope.userId as string] };
  return { sql: "", bindings: [] };
}

type Locked = {
  id: string;
  status: SupportStatus;
  ratedAt: Date | null;
  assignedAdminId: string | null;
  priority: SupportPriority;
  categoryId: string;
  subject: string;
};

// Locks the ticket for the rest of the transaction: every message and event insert on a ticket holds this lock,
// so seq follows commit order and two writers can't both act on the same status.
function lock(trx: Knex.Transaction, id: string, ownerId?: string) {
  const query = trx("supportTickets").where({ id }).forUpdate();
  if (ownerId) query.where({ userId: ownerId }).whereNull("detachedAt");
  return query.first<Locked | undefined>();
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
  // Staff opening it for the user: it starts assigned to them, in progress, with their message first.
  onBehalf?: { adminId: string; adminName: string | null };
}

function applyStaffFilters(q: Knex.QueryBuilder, query: AdminListTicketsQuery, adminId: string) {
  if (query.status) q.whereIn("t.status", query.status);
  if (query.priority) q.whereIn("t.priority", query.priority);
  if (query.categoryId) q.whereIn("t.categoryId", query.categoryId);
  if (query.rating) q.whereIn("t.rating", query.rating);
  if (query.assignedTo === "me") q.where("t.assignedAdminId", adminId);
  else if (query.assignedTo === "unassigned") q.whereNull("t.assignedAdminId");
  else if (query.assignedTo) q.where("t.assignedAdminId", query.assignedTo);
  if (query.raiserRole) q.where("t.raiserRole", query.raiserRole);
  if (query.userId) q.where("t.userId", query.userId);
  if (query.tripId) q.where("t.tripId", query.tripId);
  if (query.needsReply !== undefined) {
    if (query.needsReply) q.where("t.lastMessageSide", "user");
    else q.where((w) => w.whereNull("t.lastMessageSide").orWhere("t.lastMessageSide", "staff"));
  }
  if (query.from) q.where("t.createdAt", ">=", new Date(`${query.from}T00:00:00Z`));
  if (query.to) q.where("t.createdAt", "<", new Date(new Date(`${query.to}T00:00:00Z`).getTime() + 86_400_000));
  return q;
}

function applySort(q: Knex.QueryBuilder, sort: AdminListTicketsQuery["sort"]) {
  switch (sort) {
    case "newest":
      return q.orderBy([{ column: "t.createdAt", order: "desc" }, { column: "t.id" }]);
    case "oldest":
      return q.orderBy([{ column: "t.createdAt", order: "asc" }, { column: "t.id" }]);
    case "lastActivity":
      return q.orderBy([{ column: "t.lastMessageAt", order: "desc" }, { column: "t.id" }]);
    default:
      // Active first, then the most urgent, then whoever has waited longest.
      return q.orderByRaw(
        `CASE WHEN t.status IN ${ACTIVE_SQL} THEN 0 WHEN t.status = 'resolved' THEN 1 ELSE 2 END,
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         t."lastMessageAt" ASC, t.id`,
      );
  }
}

export const supportTicketModel = {
  // The ticket, its opening events and the first message, all or nothing. The random code can collide; the whole
  // transaction is retried with a new one.
  async create(data: CreateTicketData): Promise<{ ticket: SupportTicket; events: SupportMessage[] }> {
    const { body, attachments, onBehalf, ...ticket } = data;
    const side = onBehalf ? "staff" : "user";
    const actorId = onBehalf?.adminId ?? ticket.userId;

    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction(async (trx) => {
          await trx("supportTickets").insert({
            ...ticket,
            code: generateCode("ST"),
            ...(onBehalf && {
              status: "inProgress",
              assignedAdminId: onBehalf.adminId,
              assignedAt: trx.fn.now(),
              createdByAdminId: onBehalf.adminId,
              firstResponseAt: trx.fn.now(),
            }),
          });
          const events = [
            await supportMessageModel.insertEventIn(trx, {
              ticketId: ticket.id,
              type: "opened",
              side,
              userId: actorId,
              internal: false,
              data: onBehalf ? { onBehalf: true, byAdminId: onBehalf.adminId } : {},
            }),
          ];
          if (onBehalf) {
            events.push(
              await supportMessageModel.insertEventIn(trx, {
                ticketId: ticket.id,
                type: "assigned",
                side,
                userId: actorId,
                internal: true,
                data: { adminId: onBehalf.adminId, adminName: onBehalf.adminName, byAdminId: onBehalf.adminId },
              }),
            );
          }
          const first =
            body || attachments.length > 0
              ? await supportMessageModel.insertMessageIn(trx, {
                  ticketId: ticket.id,
                  side,
                  userId: actorId,
                  kind: "message",
                  body,
                  attachments,
                })
              : undefined;
          const latest = first ?? events.at(-1)!;
          await trx("supportTickets")
            .where({ id: ticket.id })
            .update({
              lastMessageAt: latest.createdAt,
              lastMessageSide: first ? side : null,
              [onBehalf ? "staffLastReadSeq" : "userLastReadSeq"]: latest.seq,
            });
          return { ticket: await reload(trx, ticket.id), events };
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
    const query = db(table)
      .where({ id })
      .andWhere((q) => {
        for (const column of owner) q.orWhere(column, userId);
      });
    if (link === "relatedTicketId") query.whereNull("detachedAt");
    return Boolean(await query.first("id"));
  },

  findOwned(id: string, userId: string): Promise<SupportTicket | undefined> {
    return withNames().where({ "t.id": id, "t.userId": userId }).whereNull("t.detachedAt").first();
  },

  findById(id: string): Promise<SupportTicket | undefined> {
    return withNames().where("t.id", id).first();
  },

  async listForUser(userId: string, query: ListMyTicketsQuery) {
    const base = db("supportTickets as t").where("t.userId", userId).whereNull("t.detachedAt");
    if (query.status) base.whereIn("t.status", query.status);
    if (query.tripId) base.where("t.tripId", query.tripId);

    const [items, [{ count }]] = await Promise.all([
      withNames(base.clone())
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

  async listForStaff(query: AdminListTicketsQuery, adminId: string) {
    const base = applyStaffFilters(db("supportTickets as t"), query, adminId);
    const [items, [{ count }]] = await Promise.all([
      applySort(withNames(base.clone()), query.sort)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      base.clone().count<{ count: string }[]>("* as count"),
    ]);
    return { items: items as SupportTicket[], totalItems: Number(count) };
  },

  // Tab counts over the whole queue, in one pass.
  async stats(adminId: string) {
    const row = await db("supportTickets")
      .select(
        db.raw(`count(*) FILTER (WHERE "status" = 'open')::int AS "open"`),
        db.raw(`count(*) FILTER (WHERE "status" = 'inProgress')::int AS "inProgress"`),
        db.raw(`count(*) FILTER (WHERE "status" = 'awaitingUser')::int AS "awaitingUser"`),
        db.raw(`count(*) FILTER (WHERE "status" = 'resolved')::int AS "resolved"`),
        db.raw(`count(*) FILTER (WHERE "status" = 'closed')::int AS "closed"`),
        db.raw(`count(*) FILTER (WHERE "status" IN ${ACTIVE_SQL} AND "assignedAdminId" IS NULL)::int AS "unassigned"`),
        db.raw(`count(*) FILTER (WHERE "status" IN ${ACTIVE_SQL} AND "assignedAdminId" = ?)::int AS "mine"`, [adminId]),
        db.raw(`count(*) FILTER (WHERE "status" IN ${ACTIVE_SQL} AND "lastMessageSide" = 'user')::int AS "needsReply"`),
      )
      .first();
    return row as Record<
      "open" | "inProgress" | "awaitingUser" | "resolved" | "closed" | "unassigned" | "mine" | "needsReply",
      number
    >;
  },

  // Per ticket: messages from the other side the viewer hasn't read, and the last message the viewer may see. A user
  // never sees notes; staff count user messages against their shared read marker.
  async activity(tickets: Pick<SupportTicket, "id">[], viewer: Viewer): Promise<Map<string, TicketActivity>> {
    const ids = tickets.map((t) => t.id);
    const activity = new Map<string, TicketActivity>(
      ids.map((id) => [id, { unreadCount: 0, lastMessage: null }]),
    );
    if (ids.length === 0) return activity;

    const marker = viewer === "user" ? "userLastReadSeq" : "staffLastReadSeq";
    const lastQuery = db("supportTicketMessages")
      .distinctOn("ticketId")
      .whereIn("ticketId", ids)
      .orderBy([{ column: "ticketId" }, { column: "seq", order: "desc" }])
      .select("id", "ticketId", "senderSide", "kind", "body", "attachments", "deletedAt", "createdAt");
    if (viewer === "user") lastQuery.where({ kind: "message", internal: false });
    else lastQuery.whereIn("kind", ["message", "note"]);

    const [unread, last] = await Promise.all([
      db("supportTicketMessages as m")
        .join("supportTickets as t", "t.id", "m.ticketId")
        .whereIn("m.ticketId", ids)
        .where({ "m.kind": "message", "m.internal": false })
        .where("m.senderSide", viewer === "user" ? "staff" : "user")
        .whereNull("m.deletedAt")
        .whereRaw(`m.seq > coalesce(t."${marker}", 0)`)
        .groupBy("m.ticketId")
        .select("m.ticketId")
        .count<{ ticketId: string; count: string }[]>("* as count"),
      lastQuery,
    ]);
    for (const row of unread) activity.get(row.ticketId)!.unreadCount = Number(row.count);
    for (const row of last) activity.get(row.ticketId)!.lastMessage = row;
    return activity;
  },

  // What staff see around a ticket: who raised it, what it links to, and how often this person writes in.
  async staffDetail(ticket: SupportTicket) {
    const [raiser, trip, transaction, payout, relatedTicket, history] = await Promise.all([
      db("users")
        .where({ id: ticket.userId })
        .first("id", "fullName", "role", "phoneCountryCode", "phoneNumber", "email", "status", "deletedAt"),
      ticket.tripId
        ? db("trips")
            .where({ id: ticket.tripId })
            .first("id", "status", "tripDate", "pickupAddress", "dropoffAddress", "totalAmount")
        : undefined,
      ticket.transactionId
        ? db("transactions")
            .where({ id: ticket.transactionId })
            .first("id", "type", "direction", "amount", "status", "createdAt")
        : undefined,
      ticket.payoutId
        ? db("payoutHistory").where({ id: ticket.payoutId }).first("id", "amount", "status", "createdAt")
        : undefined,
      ticket.relatedTicketId
        ? db("supportTickets").where({ id: ticket.relatedTicketId }).first("id", "code", "subject", "status")
        : undefined,
      db("supportTickets")
        .where({ userId: ticket.userId })
        .first(
          db.raw(`count(*)::int AS "totalTickets"`),
          db.raw(`count(*) FILTER (WHERE "status" IN ${ACTIVE_SQL})::int AS "activeTickets"`),
        ),
    ]);
    return { raiser, trip, transaction, payout, relatedTicket, history };
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

  async resolveByUser(id: string, userId: string): Promise<Outcome<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lock(trx, id, userId);
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
      return { ok: true, ticket: await reload(trx, id), events: [event] };
    });
  },

  async rate(
    id: string,
    userId: string,
    { rating, comment }: { rating: number; comment?: string },
  ): Promise<Outcome<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lock(trx, id, userId);
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
      return { ok: true, ticket: await reload(trx, id), events: [event] };
    });
  },

  // Status and details, one event for each kind of change. A closed ticket's status is final, but its details can
  // still be corrected. Leaving "resolved" for an active status clears the resolution and its rating.
  async changeByStaff(id: string, adminId: string, input: UpdateTicketInput): Promise<Outcome<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lock(trx, id);
      if (!locked) return { ok: false, reason: "notFound" };

      const update: Record<string, unknown> = {};
      const events: SupportMessage[] = [];
      if (input.status && input.status !== locked.status) {
        if (locked.status === "closed") return { ok: false, reason: "closed" };
        update.status = input.status;
        if (input.status === "resolved") update.resolvedAt = trx.fn.now();
        if (input.status === "closed") update.closedAt = trx.fn.now();
        if (locked.status === "resolved" && ACTIVE_SUPPORT_STATUSES.includes(input.status)) {
          Object.assign(update, { resolvedAt: null, rating: null, ratingComment: null, ratedAt: null });
        }
        events.push(
          await supportMessageModel.insertEventIn(trx, {
            ticketId: id,
            type: "statusChanged",
            side: "staff",
            userId: adminId,
            internal: false,
            data: { from: locked.status, to: input.status, byAdminId: adminId },
          }),
        );
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ["priority", "categoryId", "subject"] as const) {
        if (input[key] !== undefined && input[key] !== locked[key]) {
          changes[key] = { from: locked[key], to: input[key] };
          update[key] = input[key];
        }
      }
      if (changes.categoryId) {
        const category = await trx("supportCategories").where({ id: input.categoryId, isActive: true }).first("id");
        if (!category) return { ok: false, reason: "category" };
      }
      if (Object.keys(changes).length > 0) {
        events.push(
          await supportMessageModel.insertEventIn(trx, {
            ticketId: id,
            type: "detailsChanged",
            side: "staff",
            userId: adminId,
            internal: true,
            data: { changes, byAdminId: adminId },
          }),
        );
      }

      if (Object.keys(update).length > 0) {
        await trx("supportTickets").where({ id }).update({ ...update, updatedAt: trx.fn.now() });
      }
      return { ok: true, ticket: await reload(trx, id), events };
    });
  },

  // Self-assign, assign to someone else, or take it over from whoever has it. Picking up an open ticket starts it.
  async assign(
    id: string,
    byAdminId: string,
    to: { id: string; fullName: string | null },
  ): Promise<Outcome<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lock(trx, id);
      if (!locked) return { ok: false, reason: "notFound" };
      if (locked.status === "closed") return { ok: false, reason: "closed" };
      if (locked.assignedAdminId === to.id) return { ok: true, ticket: await reload(trx, id), events: [] };

      await trx("supportTickets")
        .where({ id })
        .update({
          assignedAdminId: to.id,
          assignedAt: trx.fn.now(),
          ...(locked.status === "open" && { status: "inProgress" }),
          updatedAt: trx.fn.now(),
        });
      const event = await supportMessageModel.insertEventIn(trx, {
        ticketId: id,
        type: "assigned",
        side: "staff",
        userId: byAdminId,
        internal: true,
        data: { adminId: to.id, adminName: to.fullName, previousAdminId: locked.assignedAdminId, byAdminId },
      });
      return { ok: true, ticket: await reload(trx, id), events: [event] };
    });
  },

  async unassign(id: string, byAdminId: string): Promise<Outcome<SupportTicket>> {
    return db.transaction(async (trx) => {
      const locked = await lock(trx, id);
      if (!locked) return { ok: false, reason: "notFound" };
      if (locked.status === "closed") return { ok: false, reason: "closed" };
      if (!locked.assignedAdminId) return { ok: true, ticket: await reload(trx, id), events: [] };

      await trx("supportTickets")
        .where({ id })
        .update({
          assignedAdminId: null,
          assignedAt: null,
          ...(locked.status === "inProgress" && { status: "open" }),
          updatedAt: trx.fn.now(),
        });
      const event = await supportMessageModel.insertEventIn(trx, {
        ticketId: id,
        type: "unassigned",
        side: "staff",
        userId: byAdminId,
        internal: true,
        data: { previousAdminId: locked.assignedAdminId, byAdminId },
      });
      return { ok: true, ticket: await reload(trx, id), events: [event] };
    });
  },

  // Who can be given tickets: active admins whose role can update support, with their current load.
  assignees(adminIds: string[]) {
    return db("users as u")
      .join("adminUsers as a", "a.userId", "u.id")
      .whereIn("u.id", adminIds)
      .select(
        "u.id",
        "u.fullName",
        "a.department",
        db.raw(
          `(SELECT count(*)::int FROM "supportTickets" t WHERE t."assignedAdminId" = u.id AND t.status IN ${ACTIVE_SQL}) AS "openTickets"`,
        ),
      )
      .orderBy("u.fullName") as Promise<
      { id: string; fullName: string | null; department: string | null; openTickets: number }[]
    >;
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
