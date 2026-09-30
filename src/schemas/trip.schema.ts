import { z } from "zod";
import { TRIP_STATUSES } from "../models/trip.model.js";
import { fareBreakdownSchema } from "./fare.schema.js";

const latitude = (example: number) =>
  z.number().min(-90).max(90).meta({ description: "Degrees, -90 to 90", example });
const longitude = (example: number) =>
  z.number().min(-180).max(180).meta({ description: "Degrees, -180 to 180", example });

// z.iso.date() also refuses dates that don't exist (2026-02-30).
const tripDateSchema = z.iso
  .date()
  .meta({ description: "Service date (Ghana time), YYYY-MM-DD", example: "2026-10-01" });

const pageFields = {
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: "Entries per page, 1-100 (default 20)" }),
};

export const tripStatusSchema = z.enum(TRIP_STATUSES).meta({
  description:
    "pending: waiting for the driver; accepted: seat confirmed and the total held in the rider's wallet; boarded: picked up (the hold became the charge); completed; declined (by the driver); cancelled (by the rider or driver); no_show; expired (the driver didn't answer in time)",
  example: "accepted",
});

export const availableTripsQuerySchema = z.object({
  lat: z.coerce
    .number()
    .min(-90)
    .max(90)
    .meta({ description: "Rider's latitude", example: 5.6224 }),
  lng: z.coerce
    .number()
    .min(-180)
    .max(180)
    .meta({ description: "Rider's longitude", example: -0.1737 }),
  date: tripDateSchema,
  ...pageFields,
});

export type AvailableTripsQuery = z.infer<typeof availableTripsQuerySchema>;

const placeSchema = (example: { address: string; lat: number; lng: number }) =>
  z.object({
    address: z.string().trim().min(3).max(255).meta({ example: example.address }),
    lat: latitude(example.lat),
    lng: longitude(example.lng),
  });

const PICKUP_EXAMPLE = { address: "Airport Junction, Accra", lat: 5.6051, lng: -0.1757 };
const DROPOFF_EXAMPLE = { address: "Danquah Circle, Osu, Accra", lat: 5.5635, lng: -0.1806 };

export const createTripSchema = z.object({
  commuteId: z.uuid().meta({ description: "The commute to ride on (from GET /trips/available)" }),
  tripDate: tripDateSchema,
  pickup: placeSchema(PICKUP_EXAMPLE),
  dropoff: placeSchema(DROPOFF_EXAMPLE),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;

export const listTripsQuerySchema = z.object({
  when: z.enum(["upcoming", "past"]).default("upcoming").meta({
    description:
      "upcoming: pending, accepted or boarded and not over yet (boarded, or the drop-off still ahead), soonest first; past: everything else, newest first",
  }),
  status: tripStatusSchema.optional().meta({ description: "Only trips with this status" }),
  ...pageFields,
});

export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;

const reasonBody = (description: string, example: string) =>
  z
    .object({
      reason: z.string().trim().min(1).max(500).optional().meta({ description, example }),
    })
    .default({});

export const cancelTripSchema = reasonBody("Why the trip is cancelled", "Plans changed");

export type CancelTripInput = z.infer<typeof cancelTripSchema>;

export const declineTripSchema = reasonBody(
  "Why the request is declined (shown to the rider)",
  "Car is full of family today",
);

export type DeclineTripInput = z.infer<typeof declineTripSchema>;

export const commuteTripsQuerySchema = z.object({
  date: tripDateSchema
    .optional()
    .meta({ description: "Service date (Ghana time), YYYY-MM-DD. Defaults to today; any date" }),
  status: tripStatusSchema.optional().meta({ description: "Only trips with this status" }),
  ...pageFields,
});

export type CommuteTripsQuery = z.infer<typeof commuteTripsQuerySchema>;

// Responses (docs only — see CLAUDE.md "API docs").

const pagination = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

const vehicleSummary = z.object({
  make: z.string().meta({ example: "Toyota" }),
  model: z.string().meta({ example: "Corolla" }),
  color: z.string().meta({ example: "Silver" }),
});

const commuteEnds = {
  startAddress: z.string().meta({ example: "Accra Mall, Tetteh Quarshie, Accra" }),
  startLat: latitude(5.6224),
  startLng: longitude(-0.1737),
  endAddress: z.string().meta({ example: "Oxford Street, Osu, Accra" }),
  endLat: latitude(5.556),
  endLng: longitude(-0.182),
  departureAt: z.iso.datetime().meta({
    description: "When the commute leaves its start on this date",
    example: "2026-10-01T07:30:00.000Z",
  }),
};

export const availableTripSchema = z.object({
  commuteId: z.uuid(),
  driver: z.object({
    id: z.uuid(),
    firstName: z.string().nullable().meta({ example: "Kwame" }),
    profilePicture: z.string().nullable(),
  }),
  vehicle: vehicleSummary.nullable().meta({
    description: "The driver's newest active vehicle, verified ones first; null if none",
  }),
  ...commuteEnds,
  seatsLeft: z.number().int().meta({ example: 2 }),
  distanceToStartMeters: z.number().int().meta({
    description: "Straight-line distance from the rider to the commute's start",
    example: 850,
  }),
  distanceMeters: z.number().int().nullable().meta({ example: 9200 }),
  durationSeconds: z.number().int().nullable().meta({ example: 1080 }),
});

export const availableTripListSchema = z.object({
  items: z
    .array(availableTripSchema)
    .meta({ description: "Nearest start first, then earliest departure" }),
  pagination,
});

const place = (example: { address: string; lat: number; lng: number }) =>
  z.object({
    address: z.string().meta({ example: example.address }),
    lat: latitude(example.lat),
    lng: longitude(example.lng),
  });

const money = (example: number, description?: string) =>
  z.number().meta({ example, ...(description && { description }) });

export const tripSchema = z.object({
  id: z.uuid(),
  commuteId: z.uuid(),
  riderUserId: z.uuid(),
  driverUserId: z.uuid(),
  tripDate: z.string().meta({ example: "2026-10-01" }),
  status: tripStatusSchema,
  pickup: place(PICKUP_EXAMPLE),
  dropoff: place(DROPOFF_EXAMPLE),
  pickupProgress: z
    .number()
    .meta({ description: "Where the pickup falls along the commute, 0..1", example: 0.25 }),
  dropoffProgress: z.number().meta({ example: 0.9 }),
  distanceMeters: z.number().int().meta({ description: "The rider's leg", example: 5600 }),
  durationSeconds: z.number().int().meta({ example: 560 }),
  scheduledPickupAt: z.iso.datetime(),
  scheduledDropoffAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable().meta({
    description: "When a pending request expires if the driver doesn't answer; null otherwise",
  }),
  fare: money(17.95, "What the driver earns"),
  platformFee: money(1.8),
  bookingFee: money(1),
  totalAmount: money(20.75, "What the rider pays: fare + fees"),
  driverEarnings: money(17.95),
  waitCharge: money(0),
  heldAmount: money(20.75, "Held in the rider's wallet while the trip is accepted"),
  fareBreakdown: fareBreakdownSchema.extend({ currency: z.literal("GHS") }),
  acceptedAt: z.iso.datetime().nullable(),
  arrivedAt: z.iso.datetime().nullable(),
  boardedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelledBy: z.enum(["rider", "driver", "system"]).nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const tripListItemSchema = tripSchema.extend({
  commute: z.object({
    startAddress: commuteEnds.startAddress,
    endAddress: commuteEnds.endAddress,
    departureAt: commuteEnds.departureAt,
  }),
  driver: z.object({
    fullName: z.string().nullable().meta({ example: "Kwame Mensah" }),
    profilePicture: z.string().nullable(),
  }),
  rider: z.object({
    firstName: z.string().nullable().meta({ example: "Ama" }),
    profilePicture: z.string().nullable(),
  }),
});

export const tripListSchema = z.object({
  items: z.array(tripListItemSchema),
  pagination,
});

export const tripDetailSchema = tripSchema.extend({
  boardingCode: z.string().nullable().meta({
    description: "Shown to the rider only (the driver scans it); null for everyone else",
    example: "TR-7KQ2MX",
  }),
  commute: z.object(commuteEnds),
  driver: z.object({
    fullName: z.string().nullable().meta({ example: "Kwame Mensah" }),
    profilePicture: z.string().nullable(),
    phone: z.string().nullable().meta({
      description: "Only for the rider, once the trip is accepted",
      example: "+233241234567",
    }),
  }),
  vehicle: vehicleSummary
    .extend({
      plate: z
        .string()
        .nullable()
        .meta({ description: "Only once the trip is accepted", example: "GR 4821-23" }),
    })
    .nullable(),
  rider: z.object({
    fullName: z.string().nullable().meta({ example: "Ama Owusu" }),
    profilePicture: z.string().nullable(),
    phone: z.string().nullable().meta({
      description: "Only for the driver, once the trip is accepted",
      example: "+233201234567",
    }),
  }),
  seatsLeft: z.number().int().meta({ description: "Seats still free on this date", example: 1 }),
  otherCommuters: z
    .array(
      z.object({
        firstName: z.string().nullable().meta({ example: "Kofi" }),
        profilePicture: z.string().nullable(),
      }),
    )
    .meta({
      description:
        "Other riders with an accepted or boarded seat on this run. Empty for the rider until their own trip is accepted",
    }),
  stops: z
    .array(
      z.object({
        type: z.enum(["pickup", "dropoff"]),
        address: z.string(),
        lat: z.number(),
        lng: z.number(),
        scheduledAt: z.iso.datetime(),
        isYou: z.boolean().meta({ description: "This trip's own pickup or drop-off" }),
      }),
    )
    .meta({
      description:
        "Pickups and drop-offs of the accepted and boarded riders on this run, in route order (no names). Until the rider's own trip is accepted, the rider sees only their own two stops",
    }),
});

export const commuteManifestSchema = z.object({
  commuteId: z.uuid(),
  date: z.string().meta({ example: "2026-10-01" }),
  departureAt: commuteEnds.departureAt,
  capacity: z.number().int().meta({ example: 3 }),
  seatsLeft: z.number().int().meta({
    description:
      "Seats still free on this date (never below 0, even if the capacity was lowered under the seats already taken)",
    example: 1,
  }),
  stops: z
    .array(
      z.object({
        type: z.enum(["pickup", "dropoff"]),
        tripId: z.uuid(),
        firstName: z.string().nullable().meta({ example: "Ama" }),
        address: z.string().meta({ example: PICKUP_EXAMPLE.address }),
        lat: z.number(),
        lng: z.number(),
        scheduledAt: z.iso.datetime(),
      }),
    )
    .meta({
      description:
        "The route sheet: pickups and drop-offs of the accepted and boarded riders on this date, in route order. Not paginated and not filtered by status",
    }),
  items: z
    .array(
      z.object({
        tripId: z.uuid(),
        status: tripStatusSchema,
        tripDate: z.string().meta({ example: "2026-10-01" }),
        rider: z.object({
          id: z.uuid(),
          fullName: z.string().nullable().meta({ example: "Ama Owusu" }),
          profilePicture: z.string().nullable(),
          phone: z.string().nullable().meta({
            description:
              "Only for the commute's driver (null for an admin), once the trip is accepted (also boarded and completed)",
            example: "+233201234567",
          }),
        }),
        pickup: place(PICKUP_EXAMPLE),
        dropoff: place(DROPOFF_EXAMPLE),
        scheduledPickupAt: z.iso.datetime(),
        scheduledDropoffAt: z.iso.datetime(),
        totalAmount: money(20.75, "What the rider pays"),
        driverEarnings: money(17.95, "What the driver earns"),
        heldAmount: money(20.75, "Held in the rider's wallet while the trip is accepted"),
      }),
    )
    .meta({
      description: "Every trip on this date (any status unless filtered), soonest pickup first",
    }),
  pagination,
});
