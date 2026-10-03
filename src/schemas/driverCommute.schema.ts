import { z } from "zod";

const addressSchema = z.string().trim().min(3).max(255);

const latitudeSchema = z.number().min(-90).max(90);

const longitudeSchema = z.number().min(-180).max(180);

const commuteFieldsSchema = z.object({
  startAddress: addressSchema.meta({
    description: "Where the commute starts, as text riders see. 3 to 255 characters, trimmed",
    example: "Accra Mall, Tetteh Quarshie, Accra",
  }),
  startLat: latitudeSchema.meta({
    description: "Latitude of the start point, degrees -90 to 90. Stored to 6 decimal places",
    example: 5.60372,
  }),
  startLng: longitudeSchema.meta({
    description: "Longitude of the start point, degrees -180 to 180. Stored to 6 decimal places",
    example: -0.17837,
  }),
  endAddress: addressSchema.meta({
    description: "Where the commute ends, as text riders see. 3 to 255 characters, trimmed",
    example: "Oxford Street, Osu, Accra",
  }),
  endLat: latitudeSchema.meta({
    description: "Latitude of the end point, degrees -90 to 90. Stored to 6 decimal places",
    example: 5.55602,
  }),
  endLng: longitudeSchema.meta({
    description: "Longitude of the end point, degrees -180 to 180. Stored to 6 decimal places",
    example: -0.1769,
  }),
  departureTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a 24-hour time, HH:MM")
    .meta({
      description:
        "Departure time of day, 24-hour HH:MM with a leading zero, in Ghana time (UTC+0, no daylight saving)",
      example: "07:30",
    }),
  recurrenceDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .refine((days) => new Set(days).size === days.length, { message: "Days must not repeat" })
    .meta({
      description:
        "Days the commute runs, ISO weekdays (1 = Monday ... 7 = Sunday). At least one, no repeats",
      example: [1, 3, 5],
    }),
  capacity: z.number().int().min(1).max(8).meta({
    description: "Seats the driver is offering on each run, 1-8",
    example: 3,
  }),
});

export const createDriverCommuteSchema = commuteFieldsSchema.extend({
  userId: z.uuid().optional().meta({
    description:
      "The driver the commute is for. Defaults to the caller; anyone else needs commutes: create. The owner must already have a driver profile",
  }),
});

export type CreateDriverCommuteInput = z.infer<typeof createDriverCommuteSchema>;

export const updateDriverCommuteSchema = commuteFieldsSchema
  .extend({
    isActive: z.boolean().meta({
      description:
        "false pauses the commute without deleting it: riders stop seeing it and new requests are refused, and it can be paused even when trips exist. true resumes it",
    }),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateDriverCommuteInput = z.infer<typeof updateDriverCommuteSchema>;

export const driverCommuteParamsSchema = z.object({
  id: z.uuid().meta({ description: "The commute's id" }),
});

export const driverCommuteResponseSchema = commuteFieldsSchema.extend({
  id: z.uuid(),
  userId: z.uuid().meta({ description: "The driver the commute belongs to" }),
  departureTime: z
    .string()
    .meta({ description: "Departure time of day, HH:MM:SS", example: "07:30:00" }),
  isActive: z.boolean(),
  distanceMeters: z.number().int().nullable().meta({
    description:
      "Driving distance from start to end in meters, saved when the commute is created or its start/end changes. Null for commutes created before this was recorded",
    example: 9200,
  }),
  durationSeconds: z.number().int().nullable().meta({
    description: "Driving time from start to end in seconds; null like distanceMeters",
    example: 1080,
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
