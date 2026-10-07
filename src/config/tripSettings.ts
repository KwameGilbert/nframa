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
    description:
      "How close, in metres, the driver must be to the pickup point, and the rider to the driver, to board",
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
  "trips.staleAfterHours": {
    type: "number",
    min: 1,
    default: 12,
    description:
      "Hours after the scheduled drop-off when an unfinished trip is settled: never boarded becomes a no-show, boarded is completed",
  },
  "trips.fallbackSpeedKmh": {
    type: "number",
    min: 1,
    default: 30,
    description:
      "Average speed, in km/h, used to estimate travel time when Google routing is unavailable",
  },
  "reports.filingWindowHours": {
    type: "number",
    min: 1,
    max: 720,
    default: 72,
    description:
      "Hours after a trip ends during which its rider or driver can still report the other person (a report can always be filed while the trip is accepted or under way)",
  },
  "notifications.retentionDays": {
    type: "number",
    min: 7,
    max: 3650,
    default: 90,
    description:
      "Days a notification stays in a user's inbox; older ones are deleted whenever that user gets a new one",
  },
  "push.deviceStaleDays": {
    type: "number",
    min: 7,
    default: 45,
    description:
      "Days after which a push device that hasn't re-registered is ignored and deleted (apps re-register on every launch, and refresh tokens last 30 days, so a device unseen this long belongs to a dead session)",
  },
  "support.reopenWindowDays": {
    type: "number",
    min: 1,
    max: 90,
    default: 7,
    description:
      "Days after a support ticket is resolved during which a reply from the user reopens it; after that it closes for good and they open a new one",
  },
  "support.autoResolveDays": {
    type: "number",
    min: 1,
    max: 90,
    default: 5,
    description:
      "Days a support ticket can wait on the user's reply before it is resolved automatically",
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
  "finance.earningsHoldHours": {
    type: "number",
    min: 0,
    max: 720,
    default: 24,
    description:
      "Hours a driver's trip earning or tip is held as pending before it can be withdrawn",
  },
} as const satisfies Record<string, TripSettingSpec>;

export type TripSettingKey = keyof typeof TRIP_SETTINGS;
type Widen<T> = T extends number ? number : T extends string ? string : T;
export type TripSettingValue<K extends TripSettingKey> = Widen<
  (typeof TRIP_SETTINGS)[K]["default"]
>;
