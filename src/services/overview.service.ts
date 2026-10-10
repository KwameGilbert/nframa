import db from "../database/knex.js";
import type { OverviewQuery, OverviewResponse } from "../schemas/overview.schema.js";

type Trend = OverviewResponse["trends"]["revenue"];
type RecentAction = OverviewResponse["recentActions"][number];

// Days are UTC calendar days, so every admin sees the same "today" whatever their timezone.
const TODAY = `(now() AT TIME ZONE 'UTC')::date`;
const DAY_OF = (column: string) => `("${column}" AT TIME ZONE 'UTC')::date`;

const OPEN_INCIDENT_STATUSES = ["triggered", "underReview", "servicesContacted"];
const OPEN_TICKET_STATUSES = ["open", "inProgress", "awaitingUser"];
const PENDING_DOCUMENT_STATUSES = ["PENDING", "UNDER_REVIEW"];

const VERIFICATION_LABELS = {
  driver: ["NATIONAL_ID", "DRIVERS_LICENSE"],
  vehicle: ["VEHICLE_REGISTRATION", "ROADWORTHINESS"],
  insurance: ["INSURANCE"],
} as const;

const DANGER_ACTION = /\.(delete|suspend|reject|cancel|revoke)/i;

const RECENT_ACTIONS_LIMIT = 20;

function trend(today: number, yesterday: number): Trend {
  const direction = today >= yesterday ? "up" : "down";
  if (yesterday === 0) return { direction, value: today === 0 ? "0%" : "+100%" };
  const change = ((today - yesterday) / yesterday) * 100;
  return { direction, value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface CountsRow {
  activeRiders: number;
  activeRidersBefore: number;
  activeCarOwners: number;
  activeCarOwnersBefore: number;
  tripsToday: number;
  tripsYesterday: number;
  revenueToday: number;
  revenueYesterday: number;
  openIncidents: number;
  pendingVerification: number;
  openTickets: number;
}

// Every headline number in one round trip; each sub-select hits its own table.
async function getCounts(): Promise<CountsRow> {
  const { rows } = await db.raw<{ rows: CountsRow[] }>(
    `
    WITH active_users AS (
      SELECT "role", "createdAt" FROM "users"
      WHERE "status" = 'active' AND "deletedAt" IS NULL AND "role" IN ('rider', 'driver')
    ),
    completed AS (
      SELECT ${DAY_OF("completedAt")} AS day
      FROM "trips"
      WHERE "status" = 'completed' AND "completedAt" >= ((${TODAY} - 1)::timestamp AT TIME ZONE 'UTC')
    ),
    -- Revenue is what the ledger recorded for the platform (platform fee plus booking fee, per completed trip).
    revenue AS (
      SELECT ${DAY_OF("createdAt")} AS day, "amount"
      FROM "transactions"
      WHERE "account" = 'platform' AND "type" = 'platformFee' AND "status" = 'success'
        AND "createdAt" >= ((${TODAY} - 1)::timestamp AT TIME ZONE 'UTC')
    )
    SELECT
      (SELECT count(*) FROM active_users WHERE "role" = 'rider')::int AS "activeRiders",
      (SELECT count(*) FROM active_users WHERE "role" = 'rider' AND "createdAt" < ${TODAY})::int AS "activeRidersBefore",
      (SELECT count(*) FROM active_users WHERE "role" = 'driver')::int AS "activeCarOwners",
      (SELECT count(*) FROM active_users WHERE "role" = 'driver' AND "createdAt" < ${TODAY})::int AS "activeCarOwnersBefore",
      (SELECT count(*) FROM completed WHERE day = ${TODAY})::int AS "tripsToday",
      (SELECT count(*) FROM completed WHERE day = ${TODAY} - 1)::int AS "tripsYesterday",
      (SELECT coalesce(sum("amount"), 0) FROM revenue WHERE day = ${TODAY})::float8 AS "revenueToday",
      (SELECT coalesce(sum("amount"), 0) FROM revenue WHERE day = ${TODAY} - 1)::float8 AS "revenueYesterday",
      (SELECT count(*) FROM "sosIncidents" WHERE "status" = ANY(?))::int AS "openIncidents",
      (SELECT count(*) FROM "verificationDocuments" WHERE "status" = ANY(?) AND "deletedAt" IS NULL)::int AS "pendingVerification",
      (SELECT count(*) FROM "supportTickets" WHERE "status" = ANY(?))::int AS "openTickets"
    `,
    [OPEN_INCIDENT_STATUSES, PENDING_DOCUMENT_STATUSES, OPEN_TICKET_STATUSES],
  );
  return rows[0]!;
}

async function getTripActivity(days: number): Promise<OverviewResponse["tripActivity"]> {
  const { rows } = await db.raw<{ rows: OverviewResponse["tripActivity"] }>(
    `
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS "date",
      (SELECT count(*) FROM "trips" t WHERE t."status" = 'completed' AND ${DAY_OF("completedAt")} = d.day)::int AS "completed",
      (SELECT count(*) FROM "trips" t WHERE t."status" = 'cancelled' AND ${DAY_OF("cancelledAt")} = d.day)::int AS "cancelled"
    FROM generate_series(${TODAY} - (?::int - 1), ${TODAY}, interval '1 day') AS d(day)
    ORDER BY d.day
    `,
    [days],
  );
  return rows;
}

async function getVerificationQueue(): Promise<OverviewResponse["verificationQueue"]> {
  const rows = await db("verificationDocuments as v")
    .join("documentTypes as dt", "dt.id", "v.documentTypeId")
    .whereIn("v.status", PENDING_DOCUMENT_STATUSES)
    .whereNull("v.deletedAt")
    .groupBy("dt.code")
    .select("dt.code")
    .select(db.raw("count(*)::int AS count"));
  const byCode = new Map(rows.map((r: { code: string; count: number }) => [r.code, r.count]));
  return Object.entries(VERIFICATION_LABELS).map(([label, codes]) => ({
    label: label as keyof typeof VERIFICATION_LABELS,
    count: codes.reduce((sum, code) => sum + (byCode.get(code) ?? 0), 0),
  }));
}

async function getRecentActions(): Promise<RecentAction[]> {
  const rows = await db("activityLogs as a")
    .leftJoin("users as u", "u.id", "a.actorId")
    .where("a.result", "success")
    .whereNot("a.method", "GET")
    .orderBy("a.createdAt", "desc")
    .limit(RECENT_ACTIONS_LIMIT)
    .select(
      "a.id",
      "a.actorId",
      "u.fullName as actorName",
      "a.module",
      "a.action",
      "a.description",
      "a.targetType",
      "a.targetId",
      "a.createdAt",
    );
  return rows.map((r: Omit<RecentAction, "tone" | "createdAt"> & { createdAt: Date }) => ({
    ...r,
    actorName: r.actorName ?? null,
    tone: DANGER_ACTION.test(r.action) ? "danger" : "success",
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getOverview({ days }: OverviewQuery): Promise<OverviewResponse> {
  const [counts, tripActivity, verificationQueue, recentActions] = await Promise.all([
    getCounts(),
    getTripActivity(days),
    getVerificationQueue(),
    getRecentActions(),
  ]);

  return {
    stats: {
      activeRiders: counts.activeRiders,
      activeCarOwners: counts.activeCarOwners,
      tripsToday: counts.tripsToday,
      revenue: round2(counts.revenueToday),
      openIncidents: counts.openIncidents,
      pendingVerification: counts.pendingVerification,
      openTickets: counts.openTickets,
    },
    trends: {
      activeRiders: trend(counts.activeRiders, counts.activeRidersBefore),
      activeCarOwners: trend(counts.activeCarOwners, counts.activeCarOwnersBefore),
      tripsToday: trend(counts.tripsToday, counts.tripsYesterday),
      revenue: trend(round2(counts.revenueToday), round2(counts.revenueYesterday)),
    },
    tripActivity,
    verificationQueue,
    recentActions,
  };
}
