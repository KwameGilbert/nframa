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

export const payoutParamsSchema = z.object({
  id: z.uuid().meta({ description: "The payout's id" }),
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

export const PAYOUT_STATUSES = [
  "pending",
  "approved",
  "paid",
  "rejected",
  "failed",
  "cancelled",
] as const;

export const payoutStatusSchema = z.enum(PAYOUT_STATUSES).meta({
  description:
    "pending: waiting for an admin (the driver can still cancel); approved: an admin approved it and is sending the money; paid: the money was sent; rejected / failed: it didn't go out and the amount is back in the balance; cancelled: the driver cancelled it and the amount is back in the balance",
  example: "pending",
});

export const requestPayoutSchema = z.strictObject({
  amount: z
    .number()
    .positive()
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, {
      message: "Amount must have at most 2 decimal places",
    })
    .meta({
      description:
        "GHS to withdraw, at most 2 decimal places: at least the payout method's minimumThreshold and at most your available balance",
      example: 100,
    }),
  payoutMethodId: z
    .uuid()
    .meta({ description: "One of your payout methods, on a verified payment method" }),
});

export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const listPayoutsQuerySchema = z.object({
  status: payoutStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: "Payouts per page, 1-100 (default 20)" }),
});

export type ListPayoutsQuery = z.infer<typeof listPayoutsQuerySchema>;

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

export const payoutResponseSchema = z.object({
  id: z.uuid(),
  driverUserId: z.uuid(),
  payoutMethodId: z
    .uuid()
    .nullable()
    .meta({ description: "null when the payout method was removed since" }),
  amount: z.number().meta({ description: "Amount in GHS", example: 100 }),
  status: payoutStatusSchema,
  transactionId: z.uuid().meta({ description: "The payout debit in your wallet transactions" }),
  decidedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "When an admin approved or rejected it" }),
  note: z.string().nullable().meta({ description: "The admin's note, e.g. why it was rejected" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const payoutPageResponseSchema = z.object({
  items: z.array(payoutResponseSchema).meta({ description: "This page's payouts, newest first" }),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});
