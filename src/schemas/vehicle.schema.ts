import { z } from "zod";

const makeSchema = z.string().min(1).meta({ example: "Toyota" });
const modelSchema = z.string().min(1).meta({ example: "Corolla" });
const yearSchema = z.number().int().meta({ example: 2018 });
const colorSchema = z.string().min(1).meta({ example: "Silver" });
const plateSchema = z.string().min(1).meta({ description: "Unique", example: "GR 1234-21" });
const seatsSchema = z.number().int().positive().meta({ example: 4 });

export const createVehicleSchema = z.object({
  carOwnerUserId: z.uuid().meta({ description: "The user who owns the vehicle" }),
  make: makeSchema,
  model: modelSchema,
  year: yearSchema.optional(),
  color: colorSchema,
  plate: plateSchema,
  seats: seatsSchema,
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    make: makeSchema,
    model: modelSchema,
    year: yearSchema,
    color: colorSchema,
    plate: plateSchema,
    seats: seatsSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const vehicleResponseSchema = z.object({
  id: z.uuid(),
  carOwnerUserId: z.uuid(),
  make: z.string().meta({ example: "Toyota" }),
  model: z.string().meta({ example: "Corolla" }),
  year: z.number().int().nullable().meta({ example: 2018 }),
  color: z.string().meta({ example: "Silver" }),
  plate: z.string().meta({ example: "GR 1234-21" }),
  seats: z.number().int().meta({ example: 4 }),
  status: z.enum(["active", "retired"]),
  isVerified: z.boolean(),
  verificationDate: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
