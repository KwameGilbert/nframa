import { z } from "zod";
import { phoneCountryCodeSchema } from "./common.schema.js";
import { userResponseSchema } from "./user.schema.js";
import { vehicleResponseSchema } from "./vehicle.schema.js";
import { verificationDocumentResponseSchema } from "./verification.schema.js";

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

export const driverCodeParamsSchema = z.object({
  code: z.string().min(1).meta({ example: "DR-7KQ2MX" }),
});

export const driverPhoneParamsSchema = z.object({
  phoneCountryCode: phoneCountryCodeSchema,
  phoneNumber: z.string().min(1).meta({ example: "541436414" }),
});

// The raw carOwnerProfiles row — no relations. Nothing returns this shape on its own anymore; it's the
// base that driverWithRelationsResponseSchema below extends.
export const driverProfileResponseSchema = z.object({
  userId: z.uuid(),
  code: z.string().meta({ description: "Generated on creation", example: "DR-7KQ2MX" }),
  verificationStatus: z.enum(["unverified", "pending", "approved", "rejected", "expiring"]).meta({
    description:
      "unverified: no docs submitted yet; pending: docs under review; approved: verified and active; rejected: docs not accepted; expiring: was approved but verification expires soon",
    example: "approved",
  }),
  ghanaCardNumber: z.string().nullable().meta({ example: "GHA-123456789-0" }),
  address: z.string().nullable().meta({ example: "12 Oxford St, Osu, Accra" }),
  isOnline: z.boolean(),
  autoAcceptBookings: z.boolean(),
  termsAcceptedAt: z.iso.datetime().nullable(),
});

// Every driver-returning endpoint (create, list, get by id/code/phone, update) responds with this same
// shape — the profile plus its user, vehicles, and verification documents — so clients never special-case
// one driver endpoint's payload against another's. See driverProfileModel.findByIdWithRelations.
export const driverWithRelationsResponseSchema = z.object({
  driver: driverProfileResponseSchema.extend({
    user: userResponseSchema,
    vehicles: z.array(vehicleResponseSchema),
    documents: z.array(verificationDocumentResponseSchema),
  }),
});
