import { z } from "zod";

const addressSchema = z.string().trim().min(3).max(255);

const latitudeSchema = z
  .number()
  .min(-90)
  .max(90)
  .meta({ description: "Degrees, -90 to 90", example: 5.60372 });

const longitudeSchema = z
  .number()
  .min(-180)
  .max(180)
  .meta({ description: "Degrees, -180 to 180", example: -0.17837 });

const commuteFieldsSchema = z.object({
  startAddress: addressSchema.meta({ example: "Accra Mall, Tetteh Quarshie, Accra" }),
  startLat: latitudeSchema,
  startLng: longitudeSchema,
  endAddress: addressSchema.meta({ example: "Oxford Street, Osu, Accra" }),
  endLat: latitudeSchema,
  endLng: longitudeSchema,
  departureTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a 24-hour time, HH:MM")
    .meta({ description: "Departure time of day, 24-hour HH:MM", example: "07:30" }),
  recurrenceDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .refine((days) => new Set(days).size === days.length, { message: "Days must not repeat" })
    .meta({
      description: "Days the commute runs, ISO weekdays (1 = Monday ... 7 = Sunday)",
      example: [1, 3, 5],
    }),
  capacity: z
    .number()
    .int()
    .min(1)
    .max(8)
    .meta({ description: "Seats the driver is offering, 1-8", example: 3 }),
});

export const createDriverCommuteSchema = commuteFieldsSchema.extend({
  userId: z.uuid().optional().meta({
    description:
      "The driver the commute is for. Defaults to the caller; anyone else needs commutes: create",
  }),
});

export type CreateDriverCommuteInput = z.infer<typeof createDriverCommuteSchema>;

export const updateDriverCommuteSchema = commuteFieldsSchema
  .extend({
    isActive: z.boolean().meta({ description: "false pauses the commute without deleting it" }),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateDriverCommuteInput = z.infer<typeof updateDriverCommuteSchema>;

export const driverCommuteParamsSchema = z.object({
  id: z.uuid(),
});

export const driverCommuteResponseSchema = commuteFieldsSchema.extend({
  id: z.uuid(),
  userId: z.uuid().meta({ description: "The driver the commute belongs to" }),
  departureTime: z
    .string()
    .meta({ description: "Departure time of day, HH:MM:SS", example: "07:30:00" }),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
