import { z } from "zod";

export const PAYMENT_METHOD_TYPES = ["card", "mobile_money", "bank_account"] as const;
export const PAYMENT_PROVIDERS = ["hubtel", "paystack"] as const;
export const VERIFICATION_STATUSES = ["pending", "verified", "failed"] as const;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

const cardMetadata = z.object({
  cardBrand: z.string().optional(),
  lastFourDigits: z.string().length(4),
  expiryMonth: z.number().min(1).max(12),
  expiryYear: z.number(),
});

const mobilemoneyMetadata = z.object({
  phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
  operator: z.string(),
});

const bankAccountMetadata = z.object({
  accountNumber: z.string().regex(/^\d{8,20}$/),
  accountName: z.string().optional(),
  bankCode: z.string(),
  bankName: z.string(),
});

export const createPaymentMethodSchema = z.object({
  type: z.enum(PAYMENT_METHOD_TYPES).meta({ example: "card" }),
  provider: z.enum(PAYMENT_PROVIDERS).meta({ example: "paystack" }),
  displayName: z
    .string()
    .max(50)
    .optional()
    .meta({ description: "User-friendly name (card name, phone, etc.)" }),
  tokenizedReference: z
    .string()
    .max(500)
    .meta({ description: "Token from Hubtel or Paystack" }),
  metadata: z
    .union([cardMetadata, mobilemoneyMetadata, bankAccountMetadata])
    .meta({ description: "Type-specific metadata with payment details" }),
});

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

export const verifyPaymentMethodSchema = z.object({
  verificationToken: z
    .string()
    .min(1)
    .max(255)
    .meta({ description: "OTP or challenge token from provider" }),
});

export type VerifyPaymentMethodInput = z.infer<typeof verifyPaymentMethodSchema>;

export const updatePaymentMethodSchema = z.object({
  displayName: z.string().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export const paymentMethodParamsSchema = z.object({
  id: z.uuid(),
});

export const listPaymentMethodsQuerySchema = z.object({
  verified: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
});

export type ListPaymentMethodsQuery = z.infer<typeof listPaymentMethodsQuerySchema>;

export const adminUpdatePaymentMethodSchema = z.object({
  isVerified: z.boolean().optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  isActive: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});

export type AdminUpdatePaymentMethodInput = z.infer<typeof adminUpdatePaymentMethodSchema>;

// Response schemas (docs only)

const paymentMethodFields = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userRole: z.enum(["rider", "driver"]),
  type: z.enum(PAYMENT_METHOD_TYPES),
  provider: z.enum(PAYMENT_PROVIDERS),
  displayName: z.string(),
  isVerified: z.boolean(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  isPrimary: z.boolean(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  verificationCompletedAt: z.string().datetime().nullable(),
});

export const paymentMethodResponseSchema = paymentMethodFields;

export const paymentMethodListResponseSchema = z.object({
  items: z.array(paymentMethodResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});
