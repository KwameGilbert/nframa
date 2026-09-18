import { z } from "zod";

export const createDriverProfileSchema = z.object({
  userId: z.uuid(),
  ghanaCardNumber: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});

export type CreateDriverProfileInput = z.infer<typeof createDriverProfileSchema>;

export const updateDriverProfileSchema = z
  .object({
    ghanaCardNumber: z.string().min(1),
    address: z.string().min(1),
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
  code: z.string(),
  verificationStatus: z.enum(["unverified", "pending", "approved", "rejected", "expiring"]),
  ghanaCardNumber: z.string().nullable(),
  address: z.string().nullable(),
  isOnline: z.boolean(),
  autoAcceptBookings: z.boolean(),
  termsAcceptedAt: z.iso.datetime().nullable(),
});
