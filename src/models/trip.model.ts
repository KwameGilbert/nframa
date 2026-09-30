import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";

export const TRIP_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "boarded",
  "completed",
  "no_show",
  "expired",
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

// A seat is used only once the trip is accepted; a pending request doesn't take one.
const SEAT_STATUSES: TripStatus[] = ["accepted", "boarded", "completed"];

export interface Trip {
  id: string;
  commuteId: string;
  riderUserId: string;
  driverUserId: string;
  tripDate: string;
  status: TripStatus;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  pickupProgress: number;
  dropoffProgress: number;
  distanceMeters: number;
  durationSeconds: number;
  scheduledPickupAt: Date;
  scheduledDropoffAt: Date;
  expiresAt: Date | null;
  fare: number;
  platformFee: number;
  bookingFee: number;
  totalAmount: number;
  driverEarnings: number;
  waitCharge: number;
  heldAmount: number;
  fareBreakdown: Record<string, unknown>;
  boardingCode: string;
  riderLat: number | null;
  riderLng: number | null;
  riderLocationAt: Date | null;
  arrivedAt: Date | null;
  boardedAt: Date | null;
  boardingLat: number | null;
  boardingLng: number | null;
  waitMinutes: number | null;
  acceptedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: "rider" | "driver" | "system" | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// pg returns numeric columns as strings; clients get numbers.
const NUMERIC_COLUMNS = [
  "pickupLat",
  "pickupLng",
  "dropoffLat",
  "dropoffLng",
  "pickupProgress",
  "dropoffProgress",
  "fare",
  "platformFee",
  "bookingFee",
  "totalAmount",
  "driverEarnings",
  "waitCharge",
  "heldAmount",
] as const;
const NULLABLE_NUMERIC_COLUMNS = ["riderLat", "riderLng", "boardingLat", "boardingLng"] as const;

class TripModel extends BaseModel<Trip> {
  protected readonly tableName = "trips";

  protected sanitize(row: Trip): Trip {
    const trip = { ...row };
    for (const column of NUMERIC_COLUMNS) trip[column] = Number(row[column]);
    for (const column of NULLABLE_NUMERIC_COLUMNS) {
      trip[column] = row[column] === null ? null : Number(row[column]);
    }
    return trip;
  }

  // Pass trx (after locking the commute row) when the count decides whether a seat can be given.
  async seatsTaken(commuteId: string, tripDate: string, trx: Knex = db): Promise<number> {
    const row = await trx("trips")
      .where({ commuteId, tripDate })
      .whereIn("status", SEAT_STATUSES)
      .first(trx.raw("count(*)::int as taken"));
    return (row as { taken: number }).taken;
  }

  async seatsLeft(commuteId: string, tripDate: string, trx: Knex = db): Promise<number> {
    const commute = await trx("driverCommutes").where({ id: commuteId }).first("capacity");
    if (!commute) return 0;
    return Math.max(commute.capacity - (await this.seatsTaken(commuteId, tripDate, trx)), 0);
  }

  // Pending requests past expiresAt are expired lazily, by whoever reads them next. Safe to run anytime: a
  // pending trip holds no money. criteria narrows it (e.g. to one commute or rider). Returns how many expired.
  expireStale(
    criteria: Partial<Pick<Trip, "id" | "commuteId" | "riderUserId" | "driverUserId">> = {},
  ) {
    return this.table
      .where({ ...criteria, status: "pending" })
      .where("expiresAt", "<=", db.fn.now())
      .update({ status: "expired", expiresAt: null, updatedAt: new Date() });
  }
}

export const tripModel = new TripModel();
