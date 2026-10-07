import { z } from "zod";

export const TRANSACTION_TYPES = [
  "topup",
  "tripCharge",
  "waitCharge",
  "driverEarning",
  "refund",
  "tip",
  "platformFee",
  "payout",
  "adjustmentCredit",
  "adjustmentDebit",
] as const;
export const TRANSACTION_DIRECTIONS = ["credit", "debit"] as const;
export const TRANSACTION_STATUSES = ["pending", "success", "failed"] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

const transactionTypeSchema = z.enum(TRANSACTION_TYPES).meta({
  description:
    "topup: money added through Paystack; tripCharge / waitCharge: a trip's fare and wait time; driverEarning: a driver's share of a trip; refund: money returned; tip: a rider's tip to a driver (a debit on the rider's wallet and a credit on the driver's); platformFee: the platform's cut of a trip (platform account only); payout: money paid out to a driver's payout method; adjustmentCredit / adjustmentDebit: a correction made by an admin",
  example: "topup",
});

const transactionStatusSchema = z.enum(TRANSACTION_STATUSES).meta({
  description:
    "pending: not settled yet (a top-up waiting for Paystack, a driver's earning or tip on hold, or a payout waiting to be paid); success: the wallet balance changed; failed: the payment didn't go through, nothing changed",
  example: "success",
});

const moneySchema = z.number().meta({ description: "Amount in GHS", example: 50 });

export const topUpSchema = z.object({
  amount: z
    .number()
    .positive()
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, {
      message: "Amount must have at most 2 decimal places",
    })
    .meta({
      description:
        "GHS to add, at most 2 decimal places, within the wallet.minTopUp and wallet.maxTopUp settings",
      example: 50,
    }),
});

export type TopUpInput = z.infer<typeof topUpSchema>;

export const topUpReferenceParamsSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .meta({ description: "The top-up's reference", example: "NF-3f9a1c0b7d2e4a6f8b1c" }),
});

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: "Transactions per page, 1-100 (default 20)" }),
  type: transactionTypeSchema.optional(),
  status: transactionStatusSchema.optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

// Only what the webhook reads; Paystack sends much more, which is let through untouched.
export const paystackEventSchema = z.looseObject({
  event: z.string().meta({ example: "charge.success" }),
  data: z.looseObject({
    reference: z.string().optional().meta({ example: "NF-3f9a1c0b7d2e4a6f8b1c" }),
  }),
});

export type PaystackEvent = z.infer<typeof paystackEventSchema>;

export const walletResponseSchema = z.object({
  balance: moneySchema.meta({ description: "Money in the wallet, in GHS", example: 120.5 }),
  heldAmount: moneySchema.meta({
    description: "Part of the balance reserved for accepted trips that haven't been charged yet",
    example: 20,
  }),
  availableBalance: moneySchema.meta({
    description: "What can be spent: balance minus heldAmount (never negative)",
    example: 100.5,
  }),
  pendingBalance: moneySchema.meta({
    description:
      "Driver earnings and tips still on hold (finance.earningsHoldHours): not in balance and not withdrawable until released",
    example: 45,
  }),
  status: z.enum(["active", "frozen"]).meta({
    description:
      "frozen: an admin froze the wallet; money still comes in and held credits still release, but nothing goes out (423)",
    example: "active",
  }),
  nextReleaseAt: z.iso.datetime().nullable().meta({
    description: "When the earliest held credit is due for release; null when nothing is on hold",
  }),
  currency: z.literal("GHS"),
});

export const transactionResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: transactionTypeSchema,
  direction: z.enum(TRANSACTION_DIRECTIONS).meta({
    description: "credit adds to the balance, debit takes from it",
    example: "credit",
  }),
  amount: moneySchema,
  currency: z.string().meta({ example: "GHS" }),
  status: transactionStatusSchema,
  provider: z.string().nullable().meta({ example: "paystack" }),
  providerReference: z.string().nullable().meta({
    description: "The payment provider's reference (a top-up's reference)",
    example: "NF-3f9a1c0b7d2e4a6f8b1c",
  }),
  tripId: z.uuid().nullable().meta({ description: "The trip it belongs to, for trip money" }),
  balanceAfter: z.number().nullable().meta({
    description: "The wallet balance right after this transaction; null until it succeeds",
    example: 170.5,
  }),
  metadata: z.record(z.string(), z.unknown()).nullable().meta({
    description: "Extra detail, e.g. failureReason when a top-up failed",
  }),
  availableAt: z.iso.datetime().nullable().meta({
    description:
      "For a held driver earning or tip: when it's released into the balance; null otherwise",
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const transactionListResponseSchema = z.object({
  items: z
    .array(transactionResponseSchema)
    .meta({ description: "This page's transactions, newest first" }),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export const topUpResponseSchema = z.object({
  reference: z.string().meta({ example: "NF-3f9a1c0b7d2e4a6f8b1c" }),
  authorizationUrl: z.url().meta({
    description: "Paystack checkout page to open for the rider",
    example: "https://checkout.paystack.com/0peioxfhpn",
  }),
  accessCode: z.string().meta({
    description: "For Paystack's mobile SDKs instead of the URL",
    example: "0peioxfhpn",
  }),
  amount: moneySchema,
  currency: z.literal("GHS"),
});
