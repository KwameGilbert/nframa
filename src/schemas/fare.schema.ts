import { z } from "zod";

const pointSchema = (example: { lat: number; lng: number }) =>
  z.object({
    lat: z
      .number()
      .min(-90)
      .max(90)
      .meta({ description: "Degrees, -90 to 90", example: example.lat }),
    lng: z
      .number()
      .min(-180)
      .max(180)
      .meta({ description: "Degrees, -180 to 180", example: example.lng }),
  });

export const estimateFareSchema = z.object({
  pickup: pointSchema({ lat: 5.6224, lng: -0.1737 }),
  dropoff: pointSchema({ lat: 5.556, lng: -0.182 }),
  waitMinutes: z.number().min(0).max(600).optional().meta({
    description: "Minutes the driver is expected to wait; the grace period is free",
    example: 8,
  }),
});

export type EstimateFareInput = z.infer<typeof estimateFareSchema>;

const money = (example: number) => z.number().meta({ example });

export const fareBreakdownSchema = z.object({
  base: money(5).meta({ description: "Flat base fare" }),
  distance: money(12.4).meta({ description: "Distance charge (km x per-km rate)" }),
  time: money(4.5).meta({ description: "Travel-time charge (minutes x per-minute rate)" }),
  wait: money(1.5).meta({ description: "Wait charge beyond the grace period" }),
  fare: money(23.4).meta({ description: "Fare subtotal: base + distance + time + wait" }),
  platformFee: money(2.34).meta({ description: "Platform fee, fixed or a percent of the fare" }),
  bookingFee: money(1).meta({ description: "Booking fee, fixed or a percent of the fare" }),
  total: money(26.74).meta({ description: "What the rider pays: fare + platformFee + bookingFee" }),
  driverEarnings: money(23.4).meta({ description: "What the driver earns: the fare subtotal" }),
});

export const fareEstimateResponseSchema = z.object({
  distanceMeters: z.number().int().meta({ example: 9200 }),
  durationSeconds: z.number().int().meta({ example: 1080 }),
  routeSource: z.enum(["google", "haversine"]).meta({
    description: "Where distance and duration came from; haversine is the straight-line fallback",
  }),
  currency: z.literal("GHS"),
  breakdown: fareBreakdownSchema,
});
