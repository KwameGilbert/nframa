import { z } from "zod";

export const PAYOUT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export const PAYOUT_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export const PAYOUT_INITIATIONS = ["manual", "automatic"] as const;

export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export type PayoutInitiation = (typeof PAYOUT_INITIATIONS)[number];

export const createPayoutMethodSchema = z.object({
  paymentMethodId: z.uuid().meta({ description: "Verified payment method to receive payouts" }),
  isAutomatic: z.boolean().default(false),
  minimumThreshold: z
    .number()
    .positive()
    .optional()
    .meta({ description: "GHS amount that triggers auto payout" }),
  payoutFrequency: z.enum(PAYOUT_FREQUENCIES).default("daily"),
});

export type CreatePayoutMethodInput = z.infer<typeof createPayoutMethodSchema>;

export const updatePayoutMethodSchema = z.object({
  isAutomatic: z.boolean().optional(),
  minimumThreshold: z.number().positive().optional(),
  payoutFrequency: z.enum(PAYOUT_FREQUENCIES).optional(),
  isPrimary: z.boolean().optional(),
});

export type UpdatePayoutMethodInput = z.infer<typeof updatePayoutMethodSchema>;

export const triggerPayoutSchema = z.object({
  amount: z.number().positive().meta({ description: "Amount to payout (GHS)" }).optional(),
});

export type TriggerPayoutInput = z.infer<typeof triggerPayoutSchema>;

export const payoutMethodParamsSchema = z.object({
  id: z.uuid(),
});

export const payoutMethodAdminParamsSchema = z.object({
  id: z.uuid(),
  driverId: z.uuid(),
});

export const payoutAdminDriverIdParamsSchema = z.object({
  driverId: z.uuid(),
});

export const listPayoutHistoryQuerySchema = z.object({
  status: z.enum(PAYOUT_STATUSES).optional(),
  initiationType: z.enum(PAYOUT_INITIATIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPayoutHistoryQuery = z.infer<typeof listPayoutHistoryQuerySchema>;

// Response schemas (docs only)

const payoutMethodFields = z.object({
  id: z.uuid(),
  paymentMethodId: z.uuid(),
  driverUserId: z.uuid(),
  isAutomatic: z.boolean(),
  minimumThreshold: z.number().meta({ example: 50.0 }),
  payoutFrequency: z.enum(PAYOUT_FREQUENCIES),
  isPrimary: z.boolean(),
  lastPayoutAt: z.string().datetime().nullable(),
  nextScheduledPayout: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const payoutMethodResponseSchema = payoutMethodFields;

export const payoutHistoryItemSchema = z.object({
  id: z.uuid(),
  driverUserId: z.uuid(),
  payoutMethodId: z.uuid(),
  amount: z.number().meta({ example: 150.5 }),
  currency: z.literal("GHS"),
  status: z.enum(PAYOUT_STATUSES),
  initiationType: z.enum(PAYOUT_INITIATIONS),
  providerReference: z.string().nullable(),
  failureReason: z.string().nullable(),
  initiatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const payoutHistoryListResponseSchema = z.object({
  items: z.array(payoutHistoryItemSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export const payoutStatsResponseSchema = z.object({
  totalPaid: z.number().meta({ description: "Total successfully paid (GHS)" }),
  totalPending: z.number().meta({ description: "Total in pending/processing (GHS)" }),
  totalFailed: z.number().meta({ description: "Total failed payouts (GHS)" }),
  lastPayoutAt: z.string().datetime().nullable(),
  completedPayoutCount: z.number().int(),
  failedPayoutCount: z.number().int(),
});
