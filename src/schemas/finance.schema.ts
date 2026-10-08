import { z } from "zod";
import {
  TRANSACTION_DIRECTIONS,
  moneySchema,
  transactionResponseSchema,
  transactionStatusSchema,
  transactionTypeSchema,
} from "./wallet.schema.js";
import { payoutResponseSchema, payoutStatusSchema } from "./payout.schema.js";

export const TRANSACTION_ACCOUNTS = ["user", "platform"] as const;
export const WALLET_STATUSES = ["active", "frozen"] as const;

const pageFields = {
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: "Items per page, 1-100 (default 20)" }),
};

const search = (description: string) =>
  z.string().trim().min(1).optional().meta({ description, example: "Ama" });

const rangeFields = {
  from: z.iso.datetime({ offset: true }).optional().meta({
    description: "Only rows created at or after this time (ISO 8601)",
    example: "2026-09-01T00:00:00Z",
  }),
  to: z.iso.datetime({ offset: true }).optional().meta({
    description: "Only rows created at or before this time (ISO 8601)",
    example: "2026-09-30T23:59:59Z",
  }),
};

const fromNotAfterTo: [(q: { from?: string; to?: string }) => boolean, { message: string; path: string[] }] = [
  (q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to),
  { message: "from must not be after to", path: ["to"] },
];

const transactionFilterFields = {
  ...pageFields,
  type: transactionTypeSchema.optional(),
  direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
  account: z
    .enum(TRANSACTION_ACCOUNTS)
    .optional()
    .meta({ description: "user: a rider's or driver's wallet; platform: the platform's own money (fees)" }),
  status: transactionStatusSchema.optional(),
  tripId: z.uuid().optional(),
  search: search("Case-insensitive search across the owner's name, email and phone, the provider reference and the admin note"),
  ...rangeFields,
};

export const listFinanceTransactionsQuerySchema = z
  .object({ ...transactionFilterFields, userId: z.uuid().optional() })
  .refine(...fromNotAfterTo);

export type ListFinanceTransactionsQuery = z.infer<typeof listFinanceTransactionsQuerySchema>;

export const listWalletTransactionsQuerySchema = z.object(transactionFilterFields).refine(...fromNotAfterTo);

export type ListWalletTransactionsQuery = z.infer<typeof listWalletTransactionsQuerySchema>;

export const financeTransactionParamsSchema = z.object({ id: z.uuid() });

export const financeWalletParamsSchema = z.object({ userId: z.uuid() });

export const listFinanceWalletsQuerySchema = z.object({
  ...pageFields,
  role: z.enum(["rider", "driver"]).optional().meta({ description: "Only riders' or drivers' wallets" }),
  status: z.enum(WALLET_STATUSES).optional(),
  search: search("Case-insensitive search across the owner's name, email and phone"),
});

export type ListFinanceWalletsQuery = z.infer<typeof listFinanceWalletsQuerySchema>;

export const listFinancePayoutsQuerySchema = z
  .object({
    ...pageFields,
    status: payoutStatusSchema.optional().meta({ description: "pending is the approval queue" }),
    search: search("Case-insensitive search across the driver's name, email and phone"),
    ...rangeFields,
  })
  .refine(...fromNotAfterTo);

export type ListFinancePayoutsQuery = z.infer<typeof listFinancePayoutsQuerySchema>;

// Responses (docs only — see CLAUDE.md "API docs").

const paginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

const ownerSchema = z
  .object({
    id: z.uuid(),
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    phoneCountryCode: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    role: z.string().meta({ example: "rider" }),
  })
  .meta({ description: "The account the money belongs to" });

const payoutTotalSchema = z.object({
  count: z.number().int(),
  amount: moneySchema,
});

export const financeOverviewResponseSchema = z.object({
  stats: z.object({
    gmv: moneySchema.meta({ description: "All successful trip and wait charges, in GHS" }),
    revenue: moneySchema.meta({ description: "All platform fee rows (platform fee plus booking fee), in GHS" }),
    gmvToday: moneySchema.meta({ description: "Trip and wait charges today (UTC)" }),
    revenueToday: moneySchema.meta({ description: "Platform fees today (UTC)" }),
  }),
  liabilities: z
    .object({
      riderBalances: moneySchema.meta({ description: "Sum of riders' wallet balances" }),
      driverAvailable: moneySchema.meta({ description: "Sum of drivers' settled, withdrawable balances" }),
      driverPending: moneySchema.meta({ description: "Sum of drivers' held earnings and tips" }),
      total: moneySchema,
    })
    .meta({ description: "Money the platform owes its users" }),
  payouts: z.object({
    pending: payoutTotalSchema.meta({ description: "Waiting for an admin" }),
    approved: payoutTotalSchema.meta({ description: "Approved, not yet marked paid" }),
  }),
  frozenWallets: z.number().int(),
  cashFlow: z
    .array(
      z.object({
        date: z.iso.date().meta({ example: "2026-10-07" }),
        inflow: moneySchema.meta({ description: "Top-ups settled that day" }),
        outflow: moneySchema.meta({ description: "Payouts marked paid that day" }),
      }),
    )
    .meta({ description: "The last 7 days, oldest first, ending today (UTC); days with nothing are 0" }),
});

export const financeTransactionResponseSchema = transactionResponseSchema.extend({
  userId: z.uuid().nullable().meta({ description: "null on platform rows" }),
  account: z.enum(TRANSACTION_ACCOUNTS),
  actorId: z.uuid().nullable().meta({ description: "The admin who made an adjustment" }),
  note: z.string().nullable().meta({ description: "The admin's reason for an adjustment" }),
  user: ownerSchema.nullable().meta({ description: "null on platform rows" }),
});

export const financeTransactionListResponseSchema = z.object({
  items: z.array(financeTransactionResponseSchema).meta({ description: "This page's transactions, newest first" }),
  pagination: paginationSchema,
  totals: z
    .object({
      credits: moneySchema.meta({ description: "Sum of credit amounts" }),
      debits: moneySchema.meta({ description: "Sum of debit amounts" }),
    })
    .meta({ description: "Over every page of the filtered set, whatever the status; filter status=success for settled money" }),
});

export const financeWalletResponseSchema = z.object({
  userId: z.uuid(),
  user: ownerSchema,
  balance: moneySchema.meta({ description: "Settled balance" }),
  heldAmount: moneySchema.meta({ description: "Reserved for a rider's trip in progress" }),
  pendingBalance: moneySchema.meta({ description: "A driver's held earnings and tips" }),
  status: z.enum(WALLET_STATUSES),
  frozenAt: z.iso.datetime().nullable(),
  frozenReason: z.string().nullable(),
  lifetimeTopUps: moneySchema.meta({ description: "Successful top-ups, ever" }),
  lifetimeEarnings: moneySchema.meta({ description: "Driver earnings and tips received, held or released" }),
  lastActivityAt: z.iso.datetime().nullable().meta({ description: "The newest transaction" }),
  createdAt: z.iso.datetime(),
});

export const financeWalletListResponseSchema = z.object({
  items: z.array(financeWalletResponseSchema).meta({ description: "This page's wallets, largest balance first" }),
  pagination: paginationSchema,
  totals: z
    .object({
      balance: moneySchema,
      pendingBalance: moneySchema,
      frozen: z.number().int().meta({ description: "Frozen wallets" }),
    })
    .meta({ description: "Over every page of the filtered set" }),
});

export const financePayoutResponseSchema = payoutResponseSchema.extend({
  decidedBy: z.uuid().nullable().meta({ description: "The admin who last decided on it" }),
  driver: ownerSchema.omit({ role: true }),
  payoutMethod: z
    .object({
      id: z.uuid(),
      type: z.string().meta({ example: "mobile_money" }),
      displayName: z.string().meta({ example: "MTN ••••4567" }),
    })
    .nullable()
    .meta({ description: "Where to send the money; null when it was removed since" }),
});

export const financePayoutListResponseSchema = z.object({
  items: z.array(financePayoutResponseSchema).meta({ description: "This page's payouts, oldest first" }),
  pagination: paginationSchema,
  totals: z.object({ amount: moneySchema }).meta({ description: "Over every page of the filtered set" }),
});

export type FinanceOverview = z.infer<typeof financeOverviewResponseSchema>;
