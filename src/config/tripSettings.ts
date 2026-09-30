import type { SettingType } from "../schemas/setting.schema.js";

// min, max (numbers) and oneOf (strings) are optional bounds: a stored value outside them is ignored, so a typo like
// "percentage" or a speed of 0 can't break fares.
export interface TripSettingSpec {
  type: SettingType;
  default: unknown;
  description: string;
  min?: number;
  max?: number;
  oneOf?: readonly string[];
}

// Every setting the fare, trip and wallet code reads: its type, the default used until an admin sets it, and what it
// controls. The reader (settingModel.getValues) falls back to the default when the row is missing or its value
// doesn't match the type, and the seed inserts these rows so they show up in GET /settings.
export const TRIP_SETTINGS = {
  "fares.baseFare": {
    type: "number",
    min: 0,
    default: 5,
    description: "Flat fare at the start of a trip, in GHS",
  },
  "fares.perKmRate": {
    type: "number",
    min: 0,
    default: 2,
    description: "Fare per kilometre, in GHS",
  },
  "fares.perMinuteRate": {
    type: "number",
    min: 0,
    default: 0.5,
    description: "Fare per minute of travel time, in GHS",
  },
  "fares.waitPerMinuteRate": {
    type: "number",
    min: 0,
    default: 0.5,
    description: "Charge per minute the driver waits past the grace period, in GHS",
  },
  "fares.waitGraceMinutes": {
    type: "number",
    min: 0,
    default: 5,
    description: "Minutes the driver waits for free before wait charges start",
  },
  "fees.platformFeeType": {
    type: "string",
    oneOf: ["fixed", "percent"],
    default: "percent",
    description: "How the platform fee is worked out: fixed (an amount) or percent (of the fare)",
  },
  "fees.platformFeeValue": {
    type: "number",
    min: 0,
    default: 10,
    description: "Platform fee: GHS if fixed, percent of the fare if percent",
  },
  "fees.bookingFeeType": {
    type: "string",
    oneOf: ["fixed", "percent"],
    default: "fixed",
    description: "How the booking fee is worked out: fixed (an amount) or percent (of the fare)",
  },
  "fees.bookingFeeValue": {
    type: "number",
    min: 0,
    default: 1,
    description: "Booking fee: GHS if fixed, percent of the fare if percent",
  },
  "trips.availabilityRadiusKm": {
    type: "number",
    min: 0,
    default: 5,
    description: "A commute is offered to a rider when its start is within this many km of them",
  },
  "trips.routeToleranceKm": {
    type: "number",
    min: 0,
    default: 1,
    description: "How far, in km, a rider's pickup and drop-off may be from the commute's route",
  },
  "trips.boardingRadiusMeters": {
    type: "number",
    min: 0,
    default: 100,
    description: "How close, in metres, driver and rider must be to the pickup point to board",
  },
  "trips.locationMaxAgeSeconds": {
    type: "number",
    min: 0,
    default: 120,
    description: "How old, in seconds, a rider's shared location may be when boarding",
  },
  "trips.requestExpiryMinutes": {
    type: "number",
    min: 0,
    default: 30,
    description: "Minutes a pending trip request waits for the driver before it expires",
  },
  "trips.bookingWindowDays": {
    type: "number",
    min: 1,
    default: 7,
    description: "How many days ahead a rider can book a trip",
  },
  "trips.boardingEarlyMinutes": {
    type: "number",
    min: 0,
    default: 30,
    description:
      "How many minutes before the scheduled pickup the driver can scan the rider on board",
  },
  "trips.boardingLateMinutes": {
    type: "number",
    min: 0,
    default: 60,
    description:
      "How many minutes after the scheduled pickup the driver can still scan the rider on board",
  },
  "trips.fallbackSpeedKmh": {
    type: "number",
    min: 1,
    default: 30,
    description:
      "Average speed, in km/h, used to estimate travel time when Google routing is unavailable",
  },
  "wallet.minTopUp": {
    type: "number",
    min: 0,
    default: 1,
    description: "Smallest amount, in GHS, a rider can add to their wallet in one top-up",
  },
  "wallet.maxTopUp": {
    type: "number",
    min: 0,
    max: 1_000_000, // far inside numeric(12,2)
    default: 5000,
    description: "Largest amount, in GHS, a rider can add to their wallet in one top-up",
  },
} as const satisfies Record<string, TripSettingSpec>;

export type TripSettingKey = keyof typeof TRIP_SETTINGS;
type Widen<T> = T extends number ? number : T extends string ? string : T;
export type TripSettingValue<K extends TripSettingKey> = Widen<
  (typeof TRIP_SETTINGS)[K]["default"]
>;
