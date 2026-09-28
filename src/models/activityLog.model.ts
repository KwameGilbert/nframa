import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type { ActivityModule, ListActivityLogsQuery } from "../schemas/activityLog.schema.js";

export interface ActivityLog {
  id: string;
  actorId: string | null;
  module: ActivityModule;
  action: string;
  description: string;
  targetType: string | null;
  targetId: string | null;
  result: "success" | "failure";
  errorMessage: string | null;
  method: string;
  path: string;
  requestBody: unknown;
  before: unknown;
  after: unknown;
  changedFields: string[] | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

export type NewActivityLog = Omit<ActivityLog, "id" | "createdAt">;

type Filters = Omit<ListActivityLogsQuery, "page" | "limit">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Target ids are stored as text, so a UUID written in upper case would never match a lower-case filter.
export function normalizeTargetId(id: string): string {
  return UUID.test(id) ? id.toLowerCase() : id;
}

const ACTOR_COLUMNS = [
  "actor.fullName as actorFullName",
  "actor.email as actorEmail",
  "actor.phoneCountryCode as actorPhoneCountryCode",
  "actor.phoneNumber as actorPhoneNumber",
  "actor.role as actorRole",
];

type Row = ActivityLog & {
  actorFullName: string | null;
  actorEmail: string | null;
  actorPhoneCountryCode: string | null;
  actorPhoneNumber: string | null;
  actorRole: string | null;
};

function withActor({
  actorFullName,
  actorEmail,
  actorPhoneCountryCode,
  actorPhoneNumber,
  actorRole,
  ...log
}: Row) {
  return {
    ...log,
    actor: log.actorId
      ? {
          id: log.actorId,
          fullName: actorFullName,
          email: actorEmail,
          phoneCountryCode: actorPhoneCountryCode,
          phoneNumber: actorPhoneNumber,
          role: actorRole,
        }
      : null,
  };
}

// jsonb columns are written JSON-encoded (see settingModel for why).
function toJson(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

class ActivityLogModel extends BaseModel<ActivityLog> {
  protected readonly tableName = "activityLogs";

  record(entry: NewActivityLog) {
    return this.table.insert({
      ...entry,
      requestBody: toJson(entry.requestBody),
      before: toJson(entry.before),
      after: toJson(entry.after),
    });
  }

  private filtered(filters: Filters) {
    const query = db("activityLogs as al").leftJoin("users as actor", "actor.id", "al.actorId");

    if (filters.actorId) query.where("al.actorId", filters.actorId);
    if (filters.actorRole) query.where("actor.role", filters.actorRole);
    if (filters.module) query.where("al.module", filters.module);
    if (filters.action) query.where("al.action", filters.action);
    if (filters.targetType) query.where("al.targetType", filters.targetType);
    if (filters.targetId) query.where("al.targetId", normalizeTargetId(filters.targetId));
    if (filters.result) query.where("al.result", filters.result);
    if (filters.from) query.where("al.createdAt", ">=", filters.from);
    if (filters.to) query.where("al.createdAt", "<=", filters.to);
    if (filters.search) {
      const term = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
      query.where((q) =>
        q
          .whereILike("al.action", term)
          .orWhereILike("al.description", term)
          .orWhereILike("al.path", term)
          .orWhereILike("al.targetId", term)
          .orWhereRaw(`al."requestBody"::text ilike ?`, [term])
          .orWhereILike("actor.fullName", term)
          .orWhereILike("actor.email", term),
      );
    }

    return query;
  }

  async list({ page, limit, ...filters }: ListActivityLogsQuery) {
    const [stats, rows] = await Promise.all([
      this.filtered(filters).first(
        db.raw("count(*)::int as total"),
        db.raw("(count(*) filter (where al.result = 'success'))::int as success"),
        db.raw("(count(*) filter (where al.result = 'failure'))::int as failure"),
        db.raw(`count(distinct al."actorId")::int as actors`),
      ) as Promise<{ total: number; success: number; failure: number; actors: number }>,
      this.filtered(filters)
        .select("al.*", ...ACTOR_COLUMNS)
        .orderBy([
          { column: "al.createdAt", order: "desc" },
          { column: "al.id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<Row[]>,
    ]);

    return { items: rows.map(withActor), stats };
  }

  async findWithActor(id: string) {
    const row: Row | undefined = await this.filtered({})
      .select("al.*", ...ACTOR_COLUMNS)
      .where("al.id", id)
      .first();
    return row && withActor(row);
  }
}

export const activityLogModel = new ActivityLogModel();
