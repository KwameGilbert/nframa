import { z } from "zod";

export const PAYOUT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];

const isAutomatic = z
  .boolean()
  .meta({ description: "Pay out automatically once the threshold is reached" });
const minimumThreshold = z
  .number()
  .min(0)
  .max(1_000_000)
  .meta({ description: "GHS balance an automatic payout waits for", example: 50 });
const payoutFrequency = z.enum(PAYOUT_FREQUENCIES);

export const createPayoutMethodSchema = z.strictObject({
  paymentMethodId: z.uuid().meta({
    description: "A verified mobile money or bank account of yours",
  }),
  isAutomatic: isAutomatic.default(false),
  minimumThreshold: minimumThreshold.default(0),
  payoutFrequency: payoutFrequency.default("daily"),
});

export type CreatePayoutMethodInput = z.infer<typeof createPayoutMethodSchema>;

export const updatePayoutMethodSchema = z
  .strictObject({
    isAutomatic: isAutomatic.optional(),
    minimumThreshold: minimumThreshold.optional(),
    payoutFrequency: payoutFrequency.optional(),
    isPrimary: z.literal(true).optional().meta({ description: "Make this the default" }),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide at least one field to update",
  });

export type UpdatePayoutMethodInput = z.infer<typeof updatePayoutMethodSchema>;

export const payoutMethodParamsSchema = z.object({
  id: z.uuid(),
});

export const adminListPayoutMethodsQuerySchema = z.object({
  driverId: z.uuid().optional(),
  isAutomatic: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminListPayoutMethodsQuery = z.infer<typeof adminListPayoutMethodsQuerySchema>;

// Responses (docs only — see CLAUDE.md "API docs").

export const payoutMethodResponseSchema = z.object({
  id: z.uuid(),
  driverUserId: z.uuid(),
  paymentMethodId: z.uuid(),
  isAutomatic: z.boolean(),
  minimumThreshold: z.number().meta({ example: 50 }),
  payoutFrequency: z.enum(PAYOUT_FREQUENCIES),
  isPrimary: z.boolean(),
  paymentMethod: z.object({
    type: z.enum(["card", "mobile_money", "bank_account"]),
    displayName: z.string().meta({ example: "MTN ****4567" }),
    verificationStatus: z.enum(["pending", "verified", "failed"]),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const payoutMethodListResponseSchema = z.object({
  items: z.array(payoutMethodResponseSchema),
});

export const payoutMethodPageResponseSchema = z.object({
  items: z.array(payoutMethodResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});
