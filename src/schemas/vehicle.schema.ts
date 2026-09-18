import { z } from "zod";

export const createVehicleSchema = z.object({
  carOwnerUserId: z.uuid(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().optional(),
  color: z.string().min(1),
  plate: z.string().min(1),
  seats: z.number().int().positive(),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int(),
    color: z.string().min(1),
    plate: z.string().min(1),
    seats: z.number().int().positive(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const vehicleResponseSchema = z.object({
  id: z.uuid(),
  carOwnerUserId: z.uuid(),
  make: z.string(),
  model: z.string(),
  year: z.number().nullable(),
  color: z.string(),
  plate: z.string(),
  seats: z.number(),
  status: z.enum(["active", "retired"]),
  isVerified: z.boolean(),
  verificationDate: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
