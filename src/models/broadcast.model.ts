import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type {
  BroadcastAudience,
  BroadcastChannel,
  BroadcastStatus,
  ListBroadcastsQuery,
} from "../schemas/broadcast.schema.js";

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  smsText: string | null;
  audience: BroadcastAudience;
  channels: BroadcastChannel[];
  status: BroadcastStatus;
  scheduledFor: Date | null;
  startedAt: Date | null;
  sentAt: Date | null;
  cancelledAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  cancelledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// With the names of the staff behind it.
export type BroadcastDetail = Broadcast & {
  createdByName: string | null;
  updatedByName: string | null;
  cancelledByName: string | null;
};

export type NewBroadcast = Pick<
  Broadcast,
  "title" | "body" | "smsText" | "audience" | "channels" | "createdBy" | "updatedBy"
>;

// Only these can be edited, rescheduled or sent; the rest belong to the delivery worker or are final.
export const EDITABLE_STATUSES: BroadcastStatus[] = ["draft", "scheduled"];

// What an SMS of the broadcast says.
export function smsTextOf(broadcast: Pick<Broadcast, "title" | "body" | "smsText">) {
  return broadcast.smsText ?? `${broadcast.title}: ${broadcast.body}`;
}

// Everyone a broadcast to this audience is for: active riders and/or drivers, never staff or deleted accounts.
// The audience preview counts these and delivery sends to them, so both always agree.
export function audienceUsers(audience: BroadcastAudience) {
  const roles =
    audience === "all" ? ["rider", "driver"] : [audience === "riders" ? "rider" : "driver"];
  return db("users as u")
    .whereIn("u.role", roles)
    .where("u.status", "active")
    .whereNull("u.deletedAt");
}

class BroadcastModel extends BaseModel<Broadcast> {
  protected readonly tableName = "broadcasts";

  private withStaff() {
    return db("broadcasts as b")
      .leftJoin("users as creator", "creator.id", "b.createdBy")
      .leftJoin("users as editor", "editor.id", "b.updatedBy")
      .leftJoin("users as canceller", "canceller.id", "b.cancelledBy")
      .select(
        "b.*",
        "creator.fullName as createdByName",
        "editor.fullName as updatedByName",
        "canceller.fullName as cancelledByName",
      );
  }

  findDetail(id: string): Promise<BroadcastDetail | undefined> {
    return this.withStaff().where("b.id", id).first();
  }

  // Newest first.
  async list(query: ListBroadcastsQuery) {
    const { status, audience, channel, search, from, to, page, limit } = query;
    const matching = () =>
      db("broadcasts as b").modify((q) => {
        if (status) q.where("b.status", status);
        if (audience) q.where("b.audience", audience);
        if (channel) q.whereRaw(`? = ANY("b"."channels")`, [channel]);
        if (search) q.whereILike("b.title", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
        if (from) q.where("b.createdAt", ">=", new Date(`${from}T00:00:00Z`));
        if (to) {
          q.where("b.createdAt", "<", new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000));
        }
      });

    const [counted, items] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      this.withStaff()
        .whereIn("b.id", matching().select("b.id"))
        .orderBy([
          { column: "b.createdAt", order: "desc" },
          { column: "b.id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<BroadcastDetail[]>,
    ]);

    return { totalItems: counted.total, items };
  }

  create(input: NewBroadcast) {
    return this.insert(input);
  }

  // Only while the broadcast is in one of these statuses: undefined when it has moved on (e.g. the worker started
  // sending it a moment ago), so a stale screen can't change what is already going out.
  async updateWhile(
    id: string,
    statuses: BroadcastStatus[],
    changes: Partial<Broadcast>,
  ): Promise<Broadcast | undefined> {
    const [row] = await this.table
      .where({ id })
      .whereIn("status", statuses)
      .update({ ...changes, updatedAt: new Date() })
      .returning("*");
    return row;
  }

  // Drafts only; false when it isn't one (anymore).
  async deleteDraft(id: string): Promise<boolean> {
    return (await this.table.where({ id, status: "draft" }).del()) > 0;
  }

  // How many people in the audience each channel reaches. Push counts people with a device seen within
  // staleDays, the ones delivery would push to.
  async audienceReach(audience: BroadcastAudience, staleDays: number) {
    const row = (await audienceUsers(audience).first(
      db.raw(`count(*)::int as "recipients"`),
      db.raw(`(count(*) filter (where u."phoneNumber" is not null))::int as "sms"`),
      db.raw(`(count(*) filter (where u."email" is not null))::int as "email"`),
      db.raw(
        `(count(*) filter (where exists (
          select 1 from "pushDevices" d where d."userId" = u."id" and d."updatedAt" >= now() - (? * interval '1 day')
        )))::int as "push"`,
        [staleDays],
      ),
    )) as { recipients: number; sms: number; email: number; push: number };

    return {
      audience,
      recipients: row.recipients,
      reachable: { inApp: row.recipients, push: row.push, sms: row.sms, email: row.email },
    };
  }
}

export const broadcastModel = new BroadcastModel();
