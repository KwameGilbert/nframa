import { z } from "zod";

const ghanaCardNumberSchema = z.string().min(1).meta({ example: "GHA-123456789-0" });
const addressSchema = z.string().min(1).meta({ example: "12 Oxford St, Osu, Accra" });

export const createDriverProfileSchema = z.object({
  userId: z.uuid().meta({ description: "An existing user with role driver" }),
  ghanaCardNumber: ghanaCardNumberSchema.optional(),
  address: addressSchema.optional(),
});

export type CreateDriverProfileInput = z.infer<typeof createDriverProfileSchema>;

export const updateDriverProfileSchema = z
  .object({
    ghanaCardNumber: ghanaCardNumberSchema,
    address: addressSchema,
    isOnline: z.boolean(),
    autoAcceptBookings: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateDriverProfileInput = z.infer<typeof updateDriverProfileSchema>;

export const driverProfileParamsSchema = z.object({
  userId: z.uuid(),
});

export const driverProfileResponseSchema = z.object({
  userId: z.uuid(),
  code: z.string().meta({ description: "Generated on creation", example: "DR-7KQ2MX" }),
  verificationStatus: z.enum(["unverified", "pending", "approved", "rejected", "expiring"]),
  ghanaCardNumber: z.string().nullable().meta({ example: "GHA-123456789-0" }),
  address: z.string().nullable().meta({ example: "12 Oxford St, Osu, Accra" }),
  isOnline: z.boolean(),
  autoAcceptBookings: z.boolean(),
  termsAcceptedAt: z.iso.datetime().nullable(),
});
