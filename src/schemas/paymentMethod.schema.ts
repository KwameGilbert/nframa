import { z } from "zod";

export const PAYMENT_METHOD_TYPES = ["card", "mobile_money", "bank_account"] as const;
export const MOBILE_MONEY_NETWORKS = ["mtn", "vodafone", "airteltigo"] as const;
export const VERIFICATION_STATUSES = ["pending", "verified", "failed"] as const;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

const displayName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .optional()
  .meta({ description: "Your own label. Defaults to one built from the details" });

// Strict objects: a client that sends a full card number or CVV is refused instead of having it ignored.
// Cards are only ever described (brand, last four, expiry); the card itself is handled by the payment
// provider once charging is integrated.
const cardSchema = z.strictObject({
  type: z.literal("card"),
  displayName,
  brand: z.string().trim().min(1).max(20).meta({ example: "Visa" }),
  lastFourDigits: z
    .string()
    .regex(/^\d{4}$/, "Must be 4 digits")
    .meta({ example: "4242" }),
  expiryMonth: z.number().int().min(1).max(12).meta({ example: 12 }),
  expiryYear: z.number().int().min(2000).max(2100).meta({ example: 2028 }),
});

const mobileMoneySchema = z.strictObject({
  type: z.literal("mobile_money"),
  displayName,
  network: z.enum(MOBILE_MONEY_NETWORKS).meta({ example: "mtn" }),
  phoneNumber: z
    .string()
    .regex(/^\+\d{10,15}$/, "Use international format, e.g. +233541234567")
    .meta({ example: "+233541234567" }),
});

const bankAccountSchema = z.strictObject({
  type: z.literal("bank_account"),
  displayName,
  bankCode: z.string().trim().min(1).max(20).meta({ example: "GCB" }),
  bankName: z.string().trim().min(1).max(100).meta({ example: "GCB Bank" }),
  accountNumber: z
    .string()
    .regex(/^\d{8,20}$/, "Must be 8 to 20 digits")
    .meta({ example: "1234567890123" }),
  accountName: z.string().trim().min(1).max(100).meta({ example: "Kwame Mensah" }),
});

export const createPaymentMethodSchema = z.discriminatedUnion("type", [
  cardSchema,
  mobileMoneySchema,
  bankAccountSchema,
]);

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = z
  .strictObject({
    displayName,
    isPrimary: z
      .literal(true)
      .optional()
      .meta({ description: "Make this the default. Only a verified method can be" }),
  })
  .refine((value) => value.displayName !== undefined || value.isPrimary !== undefined, {
    message: "Provide displayName or isPrimary",
  });

export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export const paymentMethodParamsSchema = z.object({
  id: z.uuid(),
});

export const listPaymentMethodsQuerySchema = z.object({
  verified: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .meta({ description: "Only verified (true) or not yet verified (false)" }),
});

export type ListPaymentMethodsQuery = z.infer<typeof listPaymentMethodsQuerySchema>;

export const adminListPaymentMethodsQuerySchema = z.object({
  userId: z.uuid().optional(),
  userRole: z.enum(["rider", "driver"]).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminListPaymentMethodsQuery = z.infer<typeof adminListPaymentMethodsQuerySchema>;

export const adminUpdatePaymentMethodSchema = z.strictObject({
  verificationStatus: z
    .enum(VERIFICATION_STATUSES)
    .meta({ description: "Set by staff until provider verification is integrated" }),
});

export type AdminUpdatePaymentMethodInput = z.infer<typeof adminUpdatePaymentMethodSchema>;

// Responses (docs only — see CLAUDE.md "API docs").

export const paymentMethodResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userRole: z.enum(["rider", "driver"]),
  type: z.enum(PAYMENT_METHOD_TYPES),
  displayName: z.string().meta({ example: "MTN ****4567" }),
  details: z.record(z.string(), z.unknown()).meta({
    description:
      "What was saved, with account and phone numbers masked to their last four digits. card: brand, lastFourDigits, expiryMonth, expiryYear. mobile_money: network, phoneNumber. bank_account: bankCode, bankName, accountName, accountNumber",
    example: { network: "mtn", phoneNumber: "****4567" },
  }),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  verifiedAt: z.iso.datetime().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const paymentMethodListResponseSchema = z.object({
  items: z.array(paymentMethodResponseSchema),
});

export const paymentMethodPageResponseSchema = z.object({
  items: z.array(paymentMethodResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});
