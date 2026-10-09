import type { Knex } from "knex";
import db from "../database/knex.js";
import { toTransaction, type Transaction } from "../models/transaction.model.js";
import type {
  FinanceOverview,
  ListFinancePayoutsQuery,
  ListFinanceTransactionsQuery,
  ListFinanceWalletsQuery,
} from "../schemas/finance.schema.js";

// Days are UTC calendar days, as on the overview.
const TODAY = `(now() AT TIME ZONE 'UTC')::date`;
const DAY_OF = (column: string) => `("${column}" AT TIME ZONE 'UTC')::date`;

const CASH_FLOW_DAYS = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;

const pattern = (search: string) => `%${search.replace(/[\\%_]/g, "\\$&")}%`;

const pagination = (page: number, limit: number, totalItems: number) => ({
  page,
  limit,
  totalItems,
  totalPages: Math.ceil(totalItems / limit),
});

const OWNER_COLUMNS = [
  "u.fullName as ownerFullName",
  "u.email as ownerEmail",
  "u.phoneCountryCode as ownerPhoneCountryCode",
  "u.phoneNumber as ownerPhoneNumber",
  "u.role as ownerRole",
];

interface OwnerRow {
  ownerFullName: string | null;
  ownerEmail: string | null;
  ownerPhoneCountryCode: string | null;
  ownerPhoneNumber: string | null;
  ownerRole: string | null;
}

function splitOwner<R extends OwnerRow>(id: string, row: R) {
  const { ownerFullName, ownerEmail, ownerPhoneCountryCode, ownerPhoneNumber, ownerRole, ...rest } =
    row;
  return {
    rest,
    owner: {
      id,
      fullName: ownerFullName,
      email: ownerEmail,
      phoneCountryCode: ownerPhoneCountryCode,
      phoneNumber: ownerPhoneNumber,
      role: ownerRole!,
    },
  };
}

function whereOwnerMatches(query: Knex.QueryBuilder, search: string, extra: string[] = []) {
  const like = pattern(search);
  return query.where((q) => {
    q.whereILike("u.fullName", like)
      .orWhereILike("u.email", like)
      .orWhereILike("u.phoneNumber", like);
    for (const column of extra) q.orWhereILike(column, like);
  });
}

// ---- Overview ----

interface OverviewRow {
  gmv: number;
  revenue: number;
  gmvToday: number;
  revenueToday: number;
  riderBalances: number;
  driverAvailable: number;
  driverPending: number;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  approvedAmount: number;
  frozenWallets: number;
}

export async function getFinanceOverview(): Promise<FinanceOverview> {
  const [
    {
      rows: [totals],
    },
    { rows: cashFlow },
  ] = await Promise.all([
    db.raw<{ rows: OverviewRow[] }>(`
      WITH charges AS (
        SELECT "amount", ${DAY_OF("createdAt")} AS day FROM "transactions"
        WHERE "type" IN ('tripCharge', 'waitCharge') AND "status" = 'success'
      ),
      fees AS (
        SELECT "amount", ${DAY_OF("createdAt")} AS day FROM "transactions"
        WHERE "account" = 'platform' AND "type" = 'platformFee' AND "status" = 'success'
      ),
      owed AS (
        SELECT u."role", w."balance", w."pendingBalance", w."status"
        FROM "wallets" w JOIN "users" u ON u."id" = w."userId"
      ),
      open_payouts AS (
        SELECT "status", "amount" FROM "payouts" WHERE "status" IN ('pending', 'approved')
      )
      SELECT
        (SELECT coalesce(sum("amount"), 0) FROM charges)::float8 AS "gmv",
        (SELECT coalesce(sum("amount"), 0) FROM fees)::float8 AS "revenue",
        (SELECT coalesce(sum("amount"), 0) FROM charges WHERE day = ${TODAY})::float8 AS "gmvToday",
        (SELECT coalesce(sum("amount"), 0) FROM fees WHERE day = ${TODAY})::float8 AS "revenueToday",
        (SELECT coalesce(sum("balance"), 0) FROM owed WHERE "role" = 'rider')::float8 AS "riderBalances",
        (SELECT coalesce(sum("balance"), 0) FROM owed WHERE "role" = 'driver')::float8 AS "driverAvailable",
        (SELECT coalesce(sum("pendingBalance"), 0) FROM owed WHERE "role" = 'driver')::float8 AS "driverPending",
        (SELECT count(*) FROM open_payouts WHERE "status" = 'pending')::int AS "pendingCount",
        (SELECT coalesce(sum("amount"), 0) FROM open_payouts WHERE "status" = 'pending')::float8 AS "pendingAmount",
        (SELECT count(*) FROM open_payouts WHERE "status" = 'approved')::int AS "approvedCount",
        (SELECT coalesce(sum("amount"), 0) FROM open_payouts WHERE "status" = 'approved')::float8 AS "approvedAmount",
        (SELECT count(*) FROM owed WHERE "status" = 'frozen')::int AS "frozenWallets"
    `),
    // Bucketed by updatedAt: a top-up or payout row is settled (success) when it last changes.
    db.raw<{ rows: FinanceOverview["cashFlow"] }>(
      `
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS "date",
        (SELECT coalesce(sum("amount"), 0) FROM "transactions"
          WHERE "type" = 'topup' AND "status" = 'success' AND ${DAY_OF("updatedAt")} = d.day)::float8 AS "inflow",
        (SELECT coalesce(sum("amount"), 0) FROM "transactions"
          WHERE "type" = 'payout' AND "status" = 'success' AND ${DAY_OF("updatedAt")} = d.day)::float8 AS "outflow"
      FROM generate_series(${TODAY} - (?::int - 1), ${TODAY}, interval '1 day') AS d(day)
      ORDER BY d.day
      `,
      [CASH_FLOW_DAYS],
    ),
  ]);

  const t = totals!;
  return {
    stats: {
      gmv: round2(t.gmv),
      revenue: round2(t.revenue),
      gmvToday: round2(t.gmvToday),
      revenueToday: round2(t.revenueToday),
    },
    liabilities: {
      riderBalances: round2(t.riderBalances),
      driverAvailable: round2(t.driverAvailable),
      driverPending: round2(t.driverPending),
      total: round2(t.riderBalances + t.driverAvailable + t.driverPending),
    },
    payouts: {
      pending: { count: t.pendingCount, amount: round2(t.pendingAmount) },
      approved: { count: t.approvedCount, amount: round2(t.approvedAmount) },
    },
    frozenWallets: t.frozenWallets,
    cashFlow: cashFlow.map((d) => ({ ...d, inflow: round2(d.inflow), outflow: round2(d.outflow) })),
  };
}

// ---- Transactions ----

type TransactionRow = Transaction & OwnerRow;

function toFinanceTransaction(row: TransactionRow) {
  const { rest, owner } = splitOwner(row.userId ?? "", row);
  return { ...toTransaction(rest as Transaction), user: row.userId ? owner : null };
}

function transactionsQuery() {
  return db("transactions as t").leftJoin("users as u", "u.id", "t.userId");
}

export async function getFinanceTransaction(id: string) {
  const row: TransactionRow | undefined = await transactionsQuery()
    .where("t.id", id)
    .first("t.*", ...OWNER_COLUMNS);
  return row && toFinanceTransaction(row);
}

export async function listFinanceTransactions(query: ListFinanceTransactionsQuery): Promise<{
  items: ReturnType<typeof toFinanceTransaction>[];
  pagination: ReturnType<typeof pagination>;
  totals: { credits: number; debits: number };
}> {
  const { page, limit, type, direction, account, status, userId, tripId, search, from, to } = query;

  const filtered = () => {
    const q = transactionsQuery();
    if (type) q.where("t.type", type);
    if (direction) q.where("t.direction", direction);
    if (account) q.where("t.account", account);
    if (status) q.where("t.status", status);
    if (userId) q.where("t.userId", userId);
    if (tripId) q.where("t.tripId", tripId);
    if (from) q.where("t.createdAt", ">=", from);
    if (to) q.where("t.createdAt", "<=", to);
    if (search) whereOwnerMatches(q, search, ["t.providerReference", "t.note"]);
    return q;
  };

  const [summary, rows] = await Promise.all([
    filtered().first(
      db.raw("count(*)::int as total"),
      db.raw(
        `coalesce(sum(t."amount") FILTER (WHERE t."direction" = 'credit'), 0)::float8 as credits`,
      ),
      db.raw(
        `coalesce(sum(t."amount") FILTER (WHERE t."direction" = 'debit'), 0)::float8 as debits`,
      ),
    ) as Promise<{ total: number; credits: number; debits: number }>,
    filtered()
      .select("t.*", ...OWNER_COLUMNS)
      .orderBy([
        { column: "t.createdAt", order: "desc" },
        { column: "t.id", order: "desc" },
      ])
      .limit(limit)
      .offset((page - 1) * limit) as Promise<TransactionRow[]>,
  ]);

  return {
    items: rows.map(toFinanceTransaction),
    pagination: pagination(page, limit, summary.total),
    totals: { credits: round2(summary.credits), debits: round2(summary.debits) },
  };
}

export async function walletExists(userId: string) {
  return Boolean(await db("wallets").where({ userId }).first("userId"));
}

// ---- Wallets ----

interface WalletRow extends OwnerRow {
  userId: string;
  balance: string;
  heldAmount: string;
  pendingBalance: string;
  status: "active" | "frozen";
  frozenAt: Date | null;
  frozenReason: string | null;
  lifetimeTopUps: number;
  lifetimeEarnings: number;
  lastActivityAt: Date | null;
  createdAt: Date;
}

export async function listFinanceWallets({
  page,
  limit,
  role,
  status,
  search,
}: ListFinanceWalletsQuery) {
  const filtered = () => {
    const q = db("wallets as w").join("users as u", "u.id", "w.userId");
    q.whereIn("u.role", role ? [role] : ["rider", "driver"]);
    if (status) q.where("w.status", status);
    if (search) whereOwnerMatches(q, search);
    return q;
  };

  const [summary, rows] = await Promise.all([
    filtered().first(
      db.raw("count(*)::int as total"),
      db.raw(`coalesce(sum(w."balance"), 0)::float8 as balance`),
      db.raw(`coalesce(sum(w."pendingBalance"), 0)::float8 as "pendingBalance"`),
      db.raw(`count(*) FILTER (WHERE w."status" = 'frozen')::int as frozen`),
    ) as Promise<{ total: number; balance: number; pendingBalance: number; frozen: number }>,
    filtered()
      .select(
        "w.userId",
        "w.balance",
        "w.heldAmount",
        "w.pendingBalance",
        "w.status",
        "w.frozenAt",
        "w.frozenReason",
        "w.createdAt",
        ...OWNER_COLUMNS,
        db.raw(`(
          SELECT coalesce(sum(x."amount"), 0) FROM "transactions" x
          WHERE x."userId" = w."userId" AND x."type" = 'topup' AND x."status" = 'success'
        )::float8 as "lifetimeTopUps"`),
        db.raw(`(
          SELECT coalesce(sum(x."amount"), 0) FROM "transactions" x
          WHERE x."userId" = w."userId" AND x."type" IN ('driverEarning', 'tip')
            AND x."direction" = 'credit' AND x."status" <> 'failed'
        )::float8 as "lifetimeEarnings"`),
        db.raw(
          `(SELECT max(x."createdAt") FROM "transactions" x WHERE x."userId" = w."userId") as "lastActivityAt"`,
        ),
      )
      .orderBy([
        { column: "w.balance", order: "desc" },
        { column: "w.userId", order: "asc" },
      ])
      .limit(limit)
      .offset((page - 1) * limit) as Promise<WalletRow[]>,
  ]);

  return {
    items: rows.map((row) => {
      const { rest, owner } = splitOwner(row.userId, row);
      return {
        ...rest,
        user: owner,
        balance: Number(rest.balance),
        heldAmount: Number(rest.heldAmount),
        pendingBalance: Number(rest.pendingBalance),
        lifetimeTopUps: round2(rest.lifetimeTopUps),
        lifetimeEarnings: round2(rest.lifetimeEarnings),
      };
    }),
    pagination: pagination(page, limit, summary.total),
    totals: {
      balance: round2(summary.balance),
      pendingBalance: round2(summary.pendingBalance),
      frozen: summary.frozen,
    },
  };
}

// ---- Payouts ----

interface PayoutRow extends OwnerRow {
  id: string;
  driverUserId: string;
  payoutMethodId: string | null;
  amount: string;
  paymentType: string | null;
  paymentDisplayName: string | null;
}

export async function listFinancePayouts({
  page,
  limit,
  status,
  search,
  from,
  to,
}: ListFinancePayoutsQuery) {
  const filtered = () => {
    const q = db("payouts as p").join("users as u", "u.id", "p.driverUserId");
    if (status) q.where("p.status", status);
    if (from) q.where("p.createdAt", ">=", from);
    if (to) q.where("p.createdAt", "<=", to);
    if (search) whereOwnerMatches(q, search);
    return q;
  };

  const [summary, rows] = await Promise.all([
    filtered().first(
      db.raw("count(*)::int as total"),
      db.raw(`coalesce(sum(p."amount"), 0)::float8 as amount`),
    ) as Promise<{ total: number; amount: number }>,
    filtered()
      .leftJoin("payoutMethods as pm", "pm.id", "p.payoutMethodId")
      .leftJoin("paymentMethods as pay", "pay.id", "pm.paymentMethodId")
      .select(
        "p.*",
        ...OWNER_COLUMNS,
        "pay.type as paymentType",
        "pay.displayName as paymentDisplayName",
      )
      // Oldest first: the queue is worked from the front.
      .orderBy([
        { column: "p.createdAt", order: "asc" },
        { column: "p.id", order: "asc" },
      ])
      .limit(limit)
      .offset((page - 1) * limit) as Promise<PayoutRow[]>,
  ]);

  return {
    items: rows.map((row) => {
      const { rest, owner } = splitOwner(row.driverUserId, row);
      const { paymentType, paymentDisplayName, ...payout } = rest;
      const { id, fullName, email, phoneCountryCode, phoneNumber } = owner;
      return {
        ...payout,
        amount: Number(payout.amount),
        driver: { id, fullName, email, phoneCountryCode, phoneNumber },
        payoutMethod:
          payout.payoutMethodId && paymentType
            ? { id: payout.payoutMethodId, type: paymentType, displayName: paymentDisplayName! }
            : null,
      };
    }),
    pagination: pagination(page, limit, summary.total),
    totals: { amount: round2(summary.amount) },
  };
}
