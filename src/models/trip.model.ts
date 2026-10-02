import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { settingModel } from "./setting.model.js";
import { transactionModel } from "./transaction.model.js";
import { walletModel } from "./wallet.model.js";
import { calculateWait, type WaitSettings } from "../services/fare.service.js";
import { EARTH_RADIUS_METERS, type Point } from "../services/geo.js";
import { AppError } from "../utils/AppError.js";
import { generateCode } from "../utils/code.js";
import { roundMoney } from "../utils/money.js";
import { departureAt, isoWeekday } from "../utils/tripTime.js";
import type { AdminListTripsQuery } from "../schemas/trip.schema.js";

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
// Trips still in play: at most one per rider, commute and date (trips_one_active_per_rider).
const ACTIVE_STATUSES: TripStatus[] = ["pending", "accepted", "boarded"];
// Riders who hold a seat and haven't been dropped off yet: they're the stops on a run.
const ON_BOARD_STATUSES: TripStatus[] = ["accepted", "boarded"];

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
  cancelledBy: "rider" | "driver" | "system" | "admin" | null;
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

// What the request handler works out before a trip exists; the model adds the code, status and hold.
export type NewTrip = Pick<
  Trip,
  | "commuteId"
  | "riderUserId"
  | "driverUserId"
  | "tripDate"
  | "pickupAddress"
  | "pickupLat"
  | "pickupLng"
  | "dropoffAddress"
  | "dropoffLat"
  | "dropoffLng"
  | "pickupProgress"
  | "dropoffProgress"
  | "distanceMeters"
  | "durationSeconds"
  | "scheduledPickupAt"
  | "scheduledDropoffAt"
  | "expiresAt"
  | "fare"
  | "platformFee"
  | "bookingFee"
  | "totalAmount"
  | "driverEarnings"
  | "fareBreakdown"
>;

// What the lazy sweeps are narrowed to (one trip, commute, rider or driver).
type TripCriteria = Partial<Pick<Trip, "id" | "commuteId" | "riderUserId" | "driverUserId">>;

interface Page {
  page: number;
  limit: number;
}

export interface AvailableSearch extends Point, Page {
  date: string;
  radiusMeters: number;
  excludeUserId: string;
  // HH:MM:SS, set when date is today: commutes that already left are hidden.
  departsAfter?: string;
}

export interface TripListFilter extends Page {
  userId: string;
  as: "rider" | "driver";
  when: "upcoming" | "past";
  status?: TripStatus;
}

export interface ManifestFilter extends Page {
  commuteId: string;
  tripDate: string;
  status?: TripStatus;
  // Riders' phones are for the driver alone, not for an admin reading the manifest.
  showPhones: boolean;
}

interface ManifestRow extends PhoneColumns {
  id: string;
  status: TripStatus;
  tripDate: string;
  riderUserId: string;
  riderFullName: string | null;
  riderProfilePicture: string | null;
  pickupAddress: string;
  pickupLat: string;
  pickupLng: string;
  dropoffAddress: string;
  dropoffLat: string;
  dropoffLng: string;
  scheduledPickupAt: Date;
  scheduledDropoffAt: Date;
  totalAmount: string;
  driverEarnings: string;
  heldAmount: string;
}

const COMMUTE_UNAVAILABLE = "This commute is not taking bookings";
const DUPLICATE_TRIP = "You already have a trip on this commute for that date";
const NO_SHOW_REASON = "Rider did not show up";
const NEVER_BOARDED_REASON = "The trip was never boarded";

function firstName(fullName: string | null): string | null {
  return fullName?.trim().split(/\s+/)[0] || null;
}

// The trip as clients see it: pickup and drop-off grouped, without the boarding code (the controller adds it
// for the rider only) or the location and scan fields used for boarding.
export function publicTrip(t: Trip) {
  return {
    id: t.id,
    commuteId: t.commuteId,
    riderUserId: t.riderUserId,
    driverUserId: t.driverUserId,
    tripDate: t.tripDate,
    status: t.status,
    pickup: { address: t.pickupAddress, lat: t.pickupLat, lng: t.pickupLng },
    dropoff: { address: t.dropoffAddress, lat: t.dropoffLat, lng: t.dropoffLng },
    pickupProgress: t.pickupProgress,
    dropoffProgress: t.dropoffProgress,
    distanceMeters: t.distanceMeters,
    durationSeconds: t.durationSeconds,
    scheduledPickupAt: t.scheduledPickupAt,
    scheduledDropoffAt: t.scheduledDropoffAt,
    expiresAt: t.expiresAt,
    fare: t.fare,
    platformFee: t.platformFee,
    bookingFee: t.bookingFee,
    totalAmount: t.totalAmount,
    driverEarnings: t.driverEarnings,
    waitCharge: t.waitCharge,
    waitMinutes: t.waitMinutes,
    heldAmount: t.heldAmount,
    fareBreakdown: t.fareBreakdown,
    acceptedAt: t.acceptedAt,
    arrivedAt: t.arrivedAt,
    boardedAt: t.boardedAt,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    cancelledBy: t.cancelledBy,
    cancellationReason: t.cancellationReason,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const sqlList = (statuses: TripStatus[]) => statuses.map((status) => `'${status}'`).join(", ");

// Great-circle distance in meters from the row's coordinates to point, in SQL (the same formula as
// haversineMeters), as the column alias.
function distanceSql(latColumn: string, lngColumn: string, point: Point, alias: string) {
  return db.raw(
    `2 * ${EARTH_RADIUS_METERS} * asin(least(1, sqrt(
      power(sin(radians(??::float8 - ?) / 2), 2)
      + cos(radians(?)) * cos(radians(??::float8)) * power(sin(radians(??::float8 - ?) / 2), 2)
    ))) as ??`,
    [latColumn, point.lat, point.lat, latColumn, lngColumn, point.lng, alias],
  );
}

// The vehicle shown for a driver: commutes don't name one yet, so it's their newest active vehicle, verified
// ones first. Joined as "v".
function joinDriverVehicle(query: Knex.QueryBuilder, driverColumn: string) {
  return query.joinRaw(
    `left join lateral (
      select "make", "model", "color", "plate" from "vehicles"
      where "carOwnerUserId" = ?? and "status" = 'active'
      order by "isVerified" desc, "createdAt" desc limit 1
    ) as "v" on true`,
    [driverColumn],
  );
}

const VEHICLE_COLUMNS = [
  "v.make as vehicleMake",
  "v.model as vehicleModel",
  "v.color as vehicleColor",
  "v.plate as vehiclePlate",
];

interface VehicleColumns {
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  vehiclePlate: string | null;
}

interface AvailableRow extends VehicleColumns {
  id: string;
  userId: string;
  driverFullName: string | null;
  driverProfilePicture: string | null;
  startAddress: string;
  startLat: string;
  startLng: string;
  endAddress: string;
  endLat: string;
  endLng: string;
  departureTime: string;
  seatsLeft: number;
  distanceToStartMeters: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

interface TripListRow extends Trip {
  commuteStartAddress: string;
  commuteEndAddress: string;
  commuteDepartureTime: string;
  driverFullName: string | null;
  driverProfilePicture: string | null;
  riderFullName: string | null;
  riderProfilePicture: string | null;
}

function vehicleOf(row: VehicleColumns) {
  return row.vehicleMake === null
    ? null
    : {
        make: row.vehicleMake,
        model: row.vehicleModel as string,
        color: row.vehicleColor as string,
        plate: row.vehiclePlate as string,
      };
}

interface PhoneColumns {
  phoneCountryCode: string | null;
  phoneNumber: string | null;
}

function phoneOf(row: PhoneColumns) {
  return row.phoneNumber ? `${row.phoneCountryCode ?? ""}${row.phoneNumber}` : null;
}

function isUniqueViolation(err: unknown, constraint: string) {
  const { code, constraint: name } = err as { code?: string; constraint?: string };
  return code === "23505" && name === constraint;
}

// Locks the commute row for the rest of the transaction: the first lock wherever a seat is given (see the
// lock order in walletModel), so two accepts on one commute run one after the other. The driver is re-checked
// too: one whose approval was revoked, or who was suspended or deleted, still holds a working token for a while.
async function lockBookableCommute(trx: Knex.Transaction, commuteId: string) {
  const commute = await trx("driverCommutes as c")
    .join("carOwnerProfiles as p", "p.userId", "c.userId")
    .join("users as u", "u.id", "c.userId")
    .where("c.id", commuteId)
    .forUpdate("c")
    .first("c.isActive", "p.verificationStatus", "u.status", "u.deletedAt");
  const bookable =
    commute?.isActive &&
    commute.verificationStatus === "approved" &&
    commute.status === "active" &&
    commute.deletedAt === null;
  if (!bookable) throw AppError.conflict(COMMUTE_UNAVAILABLE);
}

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
  expireStale(criteria: TripCriteria = {}) {
    return this.table
      .where({ ...criteria, status: "pending" })
      .where("expiresAt", "<=", db.fn.now())
      .update({ status: "expired", expiresAt: null, updatedAt: new Date() });
  }

  // Settles, lazily (there is no cron), what nobody finished: stale pending requests expire, and
  // trips.staleAfterHours after the scheduled drop-off an accepted trip never scanned becomes a no-show (by the
  // system, hold released) and a boarded one is completed (the driver is paid). Each trip goes through the same
  // locked, status-checked transaction as the driver's own action, so running alongside one is safe.
  async settleStale(criteria: TripCriteria = {}) {
    await this.expireStale(criteria);
    const hours = await settingModel.getValue("trips.staleAfterHours");
    const stale: Pick<Trip, "id" | "status">[] = await this.table
      .where(criteria)
      .whereIn("status", ON_BOARD_STATUSES)
      .where("scheduledDropoffAt", "<=", new Date(Date.now() - hours * 3_600_000))
      .select("id", "status");
    for (const trip of stale) {
      try {
        if (trip.status === "accepted") await this.reportNoShow(trip.id, "system");
        else await this.completeTrip(trip.id);
      } catch (err) {
        // Settled by someone else in the meantime.
        if (!(err instanceof AppError && err.statusCode === 409)) throw err;
      }
    }
  }

  // Commutes a rider can request on a date, nearest start first: active, running that weekday, driver approved
  // and active, not the rider's own, not yet departed, with a seat left, and starting within the radius (a
  // bounding box on the indexed coordinates first, then the exact distance).
  async listAvailable(search: AvailableSearch) {
    const { lat, lng, date, radiusMeters, page, limit } = search;
    const dLat = radiusMeters / 111_320;
    const dLng = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));

    const matching = () => {
      const commutes = db("driverCommutes as c")
        .join("carOwnerProfiles as p", "p.userId", "c.userId")
        .join("users as u", "u.id", "c.userId")
        .where({ "c.isActive": true, "p.verificationStatus": "approved", "u.status": "active" })
        .whereNull("u.deletedAt")
        .whereNot("c.userId", search.excludeUserId)
        .whereRaw(`? = any(c."recurrenceDays")`, [isoWeekday(date)])
        .whereBetween("c.startLat", [lat - dLat, lat + dLat])
        .whereBetween("c.startLng", [lng - dLng, lng + dLng])
        .modify((query) => {
          if (search.departsAfter) query.where("c.departureTime", ">", search.departsAfter);
        })
        .select(
          "c.*",
          "u.fullName as driverFullName",
          "u.profilePicture as driverProfilePicture",
          distanceSql("c.startLat", "c.startLng", { lat, lng }, "distanceToStartMeters"),
          db.raw(
            `c."capacity" - (select count(*)::int from "trips" t where t."commuteId" = c."id" and t."tripDate" = ? and t."status" in (${sqlList(SEAT_STATUSES)})) as "seatsLeft"`,
            [date],
          ),
        );
      return db
        .from(commutes.as("a"))
        .where("a.distanceToStartMeters", "<=", radiusMeters)
        .where("a.seatsLeft", ">", 0);
    };

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      joinDriverVehicle(matching(), "a.userId")
        .select("a.*", ...VEHICLE_COLUMNS)
        .orderBy([
          { column: "a.distanceToStartMeters", order: "asc" },
          { column: "a.departureTime", order: "asc" },
          { column: "a.id", order: "asc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<AvailableRow[]>,
    ]);

    return {
      totalItems: counted.total,
      items: rows.map((row) => {
        const vehicle = vehicleOf(row);
        return {
          commuteId: row.id,
          driver: {
            id: row.userId,
            firstName: firstName(row.driverFullName),
            profilePicture: row.driverProfilePicture,
          },
          vehicle: vehicle && { make: vehicle.make, model: vehicle.model, color: vehicle.color },
          startAddress: row.startAddress,
          startLat: Number(row.startLat),
          startLng: Number(row.startLng),
          endAddress: row.endAddress,
          endLat: Number(row.endLat),
          endLng: Number(row.endLng),
          departureAt: departureAt(date, row.departureTime),
          seatsLeft: row.seatsLeft,
          distanceToStartMeters: Math.round(row.distanceToStartMeters),
          distanceMeters: row.distanceMeters,
          durationSeconds: row.durationSeconds,
        };
      }),
    };
  }

  // Whether the rider has another trip in play whose pickup-to-drop-off window overlaps (from, to); back-to-back
  // trips are fine. The same commute is left out: trips_one_active_per_rider refuses that one with its own
  // message. Best effort: two simultaneous requests on different commutes can both pass.
  async hasOverlappingTrip(
    riderUserId: string,
    { commuteId, from, to }: { commuteId: string; from: Date; to: Date },
  ) {
    const row = await this.table
      .where({ riderUserId })
      .whereNot({ commuteId })
      .whereIn("status", ACTIVE_STATUSES)
      .where("scheduledPickupAt", "<", to)
      .where("scheduledDropoffAt", ">", from)
      .first("id");
    return row !== undefined;
  }

  // A new request: pending (no seat, no money), or accepted straight away when the driver auto-accepts, in
  // which case the seat and the hold are taken in the same transaction as the insert (commute lock first).
  async createTrip(fields: NewTrip, { autoAccept }: { autoAccept: boolean }): Promise<Trip> {
    // Boarding codes are random, so a clash is rare but possible: retry with a new one.
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction(async (trx) => {
          const row = { ...fields, boardingCode: generateCode("TR") };
          if (!autoAccept) return this.insertIn(trx, { ...row, status: "pending" });

          await lockBookableCommute(trx, fields.commuteId);
          await this.assertSeatLeft(trx, fields.commuteId, fields.tripDate);
          const trip = await this.insertIn(trx, {
            ...row,
            status: "accepted",
            acceptedAt: new Date(),
            heldAmount: fields.totalAmount,
            expiresAt: null,
          });
          await walletModel.hold(trx, fields.riderUserId, fields.totalAmount);
          return trip;
        });
      } catch (err) {
        if (isUniqueViolation(err, "trips_boardingcode_unique") && attempt < 3) continue;
        if (isUniqueViolation(err, "trips_one_active_per_rider")) {
          throw AppError.conflict(DUPLICATE_TRIP);
        }
        throw err;
      }
    }
  }

  // Accepts a pending request: gives it a seat and holds its total in the rider's wallet, in one transaction
  // taking the locks in order (commute, trip, then the rider's wallet inside hold), so two accepts can never
  // hand out the same seat or the same money.
  async acceptWithHold(tripId: string): Promise<Trip> {
    const found = await this.findById(tripId);
    if (!found) throw AppError.notFound(`Trip not found: ${tripId}`);

    return db.transaction(async (trx) => {
      await lockBookableCommute(trx, found.commuteId);
      const trip = await this.lockIn(trx, tripId);
      if (trip.status !== "pending")
        throw AppError.conflict(`Can't accept a trip that is ${trip.status}`);
      if (trip.expiresAt && trip.expiresAt <= new Date()) {
        throw AppError.conflict("Can't accept a trip that is expired");
      }
      await this.assertSeatLeft(trx, trip.commuteId, trip.tripDate);
      try {
        await walletModel.hold(trx, trip.riderUserId, trip.totalAmount);
      } catch (err) {
        // The request passed the balance check when made, but the rider may have spent the money since.
        if (err instanceof AppError && err.statusCode === 409) {
          throw AppError.conflict("The rider's wallet no longer covers this trip");
        }
        throw err;
      }
      return this.updateIn(trx, tripId, {
        status: "accepted",
        acceptedAt: new Date(),
        heldAmount: trip.totalAmount,
        expiresAt: null,
      });
    });
  }

  // Riders cancel pending or accepted trips; drivers only accepted ones (a pending request is declined); admins can cancel pending or accepted trips.
  cancelTrip(
    tripId: string,
    { by, reason }: { by: "rider" | "driver" | "system" | "admin"; reason?: string },
  ) {
    const from: TripStatus[] = by === "driver" ? ["accepted"] : ["pending", "accepted"];
    return this.closeTrip(tripId, { status: "cancelled", verb: "cancel", from, by, reason });
  }

  // The driver says no to a pending request. It holds no money, so nothing moves.
  declineTrip(tripId: string, reason?: string) {
    return this.closeTrip(tripId, {
      status: "declined",
      verb: "decline",
      from: ["pending"],
      by: "driver",
      reason,
    });
  }

  // The rider never came: the hold goes back and nobody is charged or paid.
  reportNoShow(tripId: string, by: "driver" | "system") {
    return this.closeTrip(tripId, {
      status: "no_show",
      verb: "report a no-show for",
      from: ["accepted"],
      by,
      reason: by === "driver" ? NO_SHOW_REASON : NEVER_BOARDED_REASON,
    });
  }

  // Ends a trip before boarding. The status is re-checked under the row lock, and an accepted trip's hold goes
  // back to the rider with it.
  private async closeTrip(
    tripId: string,
    close: {
      status: "cancelled" | "declined" | "no_show";
      verb: string;
      from: TripStatus[];
      by: "rider" | "driver" | "system" | "admin";
      reason?: string;
    },
  ): Promise<Trip> {
    return db.transaction(async (trx) => {
      const trip = await this.lockIn(trx, tripId);
      if (!close.from.includes(trip.status)) {
        throw AppError.conflict(`Can't ${close.verb} a trip that is ${trip.status}`);
      }
      if (trip.heldAmount > 0) await walletModel.release(trx, trip.riderUserId, trip.heldAmount);
      return this.updateIn(trx, tripId, {
        status: close.status,
        heldAmount: 0,
        expiresAt: null,
        cancelledAt: new Date(),
        cancelledBy: close.by,
        cancellationReason: close.reason ?? null,
      });
    });
  }

  // The driver marks arrival at the pickup (wait time counts from here). Only the first mark counts: changed is
  // false when it was already set.
  markArrived(tripId: string): Promise<{ trip: Trip; changed: boolean }> {
    return db.transaction(async (trx) => {
      const trip = await this.lockIn(trx, tripId);
      if (trip.status !== "accepted") {
        throw AppError.conflict(`Can't mark arrival for a trip that is ${trip.status}`);
      }
      if (trip.arrivedAt) return { trip, changed: false };
      return { trip: await this.updateIn(trx, tripId, { arrivedAt: new Date() }), changed: true };
    });
  }

  // The rider's last shared location, which the boarding scan checks against the driver's.
  async shareRiderLocation(tripId: string, { lat, lng }: Point) {
    const riderLocationAt = new Date();
    await this.table
      .where({ id: tripId })
      .update({ riderLat: lat, riderLng: lng, riderLocationAt, updatedAt: riderLocationAt });
    return { tripId, lat, lng, recordedAt: riderLocationAt };
  }

  // A trip on one of the driver's commutes by its boarding code. Someone else's code finds nothing.
  findByBoardingCode(boardingCode: string, driverUserId: string) {
    return this.findOne({ boardingCode, driverUserId });
  }

  // The boarding scan, in one transaction taking the trip row, then the rider's wallet: the hold becomes the trip's
  // charge, and wait past the grace is debited on top (it may take the wallet below zero). The status re-check
  // under the lock, with transactions_one_per_trip_type as the backstop, makes two simultaneous scans charge once.
  boardTrip(tripId: string, at: Point, wait: WaitSettings): Promise<Trip> {
    return db.transaction(async (trx) => {
      const trip = await this.lockIn(trx, tripId);
      if (trip.status !== "accepted") {
        throw AppError.conflict(`Can't board a trip that is ${trip.status}`);
      }
      // Accepting holds exactly the total: anything else is a bug, and boarding would undercharge.
      if (trip.heldAmount !== trip.totalAmount) {
        throw new Error(
          `Trip ${tripId} holds ${trip.heldAmount}, not its total ${trip.totalAmount}`,
        );
      }
      const boardedAt = new Date();
      const { waitMinutes, waitCharge } = calculateWait({ ...trip, boardedAt }, wait);
      const rider = { userId: trip.riderUserId, tripId };
      await walletModel.capture(trx, { ...rider, amount: trip.heldAmount });
      if (waitCharge > 0) {
        await walletModel.recordIn(trx, {
          ...rider,
          type: "wait_charge",
          direction: "debit",
          amount: waitCharge,
        });
      }
      return this.updateIn(trx, tripId, {
        status: "boarded",
        boardedAt,
        boardingLat: at.lat,
        boardingLng: at.lng,
        waitMinutes,
        waitCharge,
        heldAmount: 0,
        driverEarnings: roundMoney(trip.fare + waitCharge),
      });
    });
  }

  // Pays the driver for a boarded trip (fare plus any wait charge), once: the status is re-checked under the trip
  // lock, with transactions_one_per_trip_type as the backstop.
  completeTrip(tripId: string): Promise<Trip> {
    return db.transaction(async (trx) => {
      const trip = await this.lockIn(trx, tripId);
      if (trip.status !== "boarded") {
        throw AppError.conflict(`Can't complete a trip that is ${trip.status}`);
      }
      if (trip.driverEarnings > 0) {
        await walletModel.recordIn(trx, {
          userId: trip.driverUserId,
          tripId,
          type: "driver_earning",
          direction: "credit",
          amount: trip.driverEarnings,
        });
      }
      return this.updateIn(trx, tripId, { status: "completed", completedAt: new Date() });
    });
  }

  // Everything GET /trips/:id shows, before it's narrowed to what the viewer may see.
  async findDetail(id: string) {
    const trip = await this.findById(id);
    if (!trip) return undefined;

    const [context, rider, riders, seatsLeft] = await Promise.all([
      joinDriverVehicle(
        db("driverCommutes as c").join("users as d", "d.id", "c.userId"),
        "c.userId",
      )
        .where("c.id", trip.commuteId)
        .first(
          "c.startAddress",
          "c.startLat",
          "c.startLng",
          "c.endAddress",
          "c.endLat",
          "c.endLng",
          "c.departureTime",
          "d.fullName",
          "d.profilePicture",
          "d.phoneCountryCode",
          "d.phoneNumber",
          ...VEHICLE_COLUMNS,
        ),
      db("users")
        .where({ id: trip.riderUserId })
        .first("fullName", "profilePicture", "phoneCountryCode", "phoneNumber"),
      this.ridersOnRun(trip.commuteId, trip.tripDate),
      this.seatsLeft(trip.commuteId, trip.tripDate),
    ]);

    return {
      trip,
      commute: {
        startAddress: context.startAddress as string,
        startLat: Number(context.startLat),
        startLng: Number(context.startLng),
        endAddress: context.endAddress as string,
        endLat: Number(context.endLat),
        endLng: Number(context.endLng),
        departureAt: departureAt(trip.tripDate, context.departureTime),
      },
      driver: {
        fullName: context.fullName as string | null,
        profilePicture: context.profilePicture as string | null,
        phone: phoneOf(context),
      },
      rider: {
        fullName: rider.fullName as string | null,
        profilePicture: rider.profilePicture as string | null,
        phone: phoneOf(rider),
      },
      vehicle: vehicleOf(context),
      seatsLeft,
      riders,
    };
  }

  // Everything an admin sees on GET /admin/trips/:id: the trip with its commute, both people, the vehicle, every
  // trip on the same run (who joined), and the money the trip moved. Unshaped: the controller decides what to show.
  async findAdminOverview(id: string) {
    const detail = await this.findDetail(id);
    if (!detail) return undefined;
    const { trip } = detail;

    const [commute, people, profile, run, seatsTaken, ledger] = await Promise.all([
      db("driverCommutes").where({ id: trip.commuteId }).first(),
      db("users")
        .whereIn("id", [trip.riderUserId, trip.driverUserId])
        .select("id", "fullName", "profilePicture", "status", "createdAt", "deletedAt"),
      db("carOwnerProfiles")
        .where({ userId: trip.driverUserId })
        .first("verificationStatus", "isOnline", "autoAcceptBookings"),
      db("trips as t")
        .join("users as r", "r.id", "t.riderUserId")
        .where({ "t.commuteId": trip.commuteId, "t.tripDate": trip.tripDate })
        .orderBy([
          { column: "t.createdAt", order: "asc" },
          { column: "t.id", order: "asc" },
        ])
        .select(
          "t.id",
          "t.status",
          "t.riderUserId",
          "r.fullName as riderFullName",
          "r.profilePicture as riderProfilePicture",
          "t.pickupAddress",
          "t.dropoffAddress",
          "t.scheduledPickupAt",
          "t.totalAmount",
          "t.acceptedAt",
          "t.boardedAt",
          "t.completedAt",
          "t.cancelledAt",
          "t.cancelledBy",
          "t.createdAt",
        ),
      this.seatsTaken(trip.commuteId, trip.tripDate),
      transactionModel.listForTrip(id),
    ]);

    return { detail, commute, people, profile, run, seatsTaken, ledger };
  }

  // The riders holding a seat on one date's run (accepted or boarded), with their pickup and drop-off.
  async ridersOnRun(commuteId: string, tripDate: string) {
    const rows = await db("trips as t")
      .join("users as r", "r.id", "t.riderUserId")
      .where({ "t.commuteId": commuteId, "t.tripDate": tripDate })
      .whereIn("t.status", ON_BOARD_STATUSES)
      .orderBy([
        { column: "t.createdAt", order: "asc" },
        { column: "t.id", order: "asc" },
      ])
      .select(
        "t.id",
        "r.fullName",
        "r.profilePicture",
        "t.pickupAddress",
        "t.pickupLat",
        "t.pickupLng",
        "t.pickupProgress",
        "t.scheduledPickupAt",
        "t.dropoffAddress",
        "t.dropoffLat",
        "t.dropoffLng",
        "t.dropoffProgress",
        "t.scheduledDropoffAt",
      );
    return rows.map((row) => ({
      tripId: row.id as string,
      firstName: firstName(row.fullName),
      profilePicture: row.profilePicture as string | null,
      pickup: {
        address: row.pickupAddress as string,
        lat: Number(row.pickupLat),
        lng: Number(row.pickupLng),
        progress: Number(row.pickupProgress),
        scheduledAt: row.scheduledPickupAt as Date,
      },
      dropoff: {
        address: row.dropoffAddress as string,
        lat: Number(row.dropoffLat),
        lng: Number(row.dropoffLng),
        progress: Number(row.dropoffProgress),
        scheduledAt: row.scheduledDropoffAt as Date,
      },
    }));
  }

  // A rider's own trips, or the trips on a driver's commutes. upcoming: in play (pending, accepted or boarded) and
  // not over yet (boarded, or drop-off still ahead), soonest first; past: everything else, newest first.
  async listForUser({ userId, as, when, status, page, limit }: TripListFilter) {
    const matching = () =>
      db("trips as t")
        .where(as === "rider" ? "t.riderUserId" : "t.driverUserId", userId)
        .modify((query) => {
          const upcoming = (q: Knex.QueryBuilder) =>
            q
              .whereIn("t.status", ACTIVE_STATUSES)
              .where((ahead) =>
                ahead
                  .where("t.status", "boarded")
                  .orWhere("t.scheduledDropoffAt", ">=", db.fn.now()),
              );
          if (when === "upcoming") upcoming(query);
          else query.whereNot(upcoming);
          if (status) query.where("t.status", status);
        });
    const order = when === "upcoming" ? "asc" : "desc";

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .join("driverCommutes as c", "c.id", "t.commuteId")
        .join("users as d", "d.id", "t.driverUserId")
        .join("users as r", "r.id", "t.riderUserId")
        .select(
          "t.*",
          "c.startAddress as commuteStartAddress",
          "c.endAddress as commuteEndAddress",
          "c.departureTime as commuteDepartureTime",
          "d.fullName as driverFullName",
          "d.profilePicture as driverProfilePicture",
          "r.fullName as riderFullName",
          "r.profilePicture as riderProfilePicture",
        )
        .orderBy([
          { column: "t.scheduledPickupAt", order },
          { column: "t.id", order },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<TripListRow[]>,
    ]);

    return {
      totalItems: counted.total,
      items: rows.map((row) => {
        const trip = this.sanitize(row);
        return {
          ...publicTrip(trip),
          commute: {
            startAddress: row.commuteStartAddress,
            endAddress: row.commuteEndAddress,
            departureAt: departureAt(trip.tripDate, row.commuteDepartureTime),
          },
          driver: { fullName: row.driverFullName, profilePicture: row.driverProfilePicture },
          rider: {
            firstName: firstName(row.riderFullName),
            profilePicture: row.riderProfilePicture,
          },
        };
      }),
    };
  }

  // Admin list of all trips with filters and pagination.
  async listAll({
    status,
    riderUserId,
    driverUserId,
    commuteId,
    tripDate,
    search,
    page,
    limit,
  }: AdminListTripsQuery) {
    const matching = () =>
      db("trips as t")
        .modify((query) => {
          if (status) query.where("t.status", status);
          if (riderUserId) query.where("t.riderUserId", riderUserId);
          if (driverUserId) query.where("t.driverUserId", driverUserId);
          if (commuteId) query.where("t.commuteId", commuteId);
          if (tripDate) query.where("t.tripDate", tripDate);
          if (search) {
            const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
            query.where((q) =>
              q
                .whereILike("t.pickupAddress", term)
                .orWhereILike("t.dropoffAddress", term)
                .orWhereILike("t.boardingCode", term)
                .orWhereILike("d.fullName", term)
                .orWhereILike("d.email", term)
                .orWhereILike("r.fullName", term)
                .orWhereILike("r.email", term),
            );
          }
        });

    const countQuery = matching()
      .leftJoin("users as d", "d.id", "t.driverUserId")
      .leftJoin("users as r", "r.id", "t.riderUserId");

    const [counted, rows] = await Promise.all([
      countQuery.first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .join("driverCommutes as c", "c.id", "t.commuteId")
        .join("users as d", "d.id", "t.driverUserId")
        .join("users as r", "r.id", "t.riderUserId")
        .select(
          "t.*",
          "c.startAddress as commuteStartAddress",
          "c.endAddress as commuteEndAddress",
          "c.departureTime as commuteDepartureTime",
          "d.fullName as driverFullName",
          "d.profilePicture as driverProfilePicture",
          "r.fullName as riderFullName",
          "r.profilePicture as riderProfilePicture",
        )
        .orderBy([
          { column: "t.scheduledPickupAt", order: "desc" },
          { column: "t.id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<TripListRow[]>,
    ]);

    return {
      totalItems: counted.total,
      items: rows.map((row) => {
        const trip = this.sanitize(row);
        return {
          ...publicTrip(trip),
          commute: {
            startAddress: row.commuteStartAddress,
            endAddress: row.commuteEndAddress,
            departureAt: departureAt(trip.tripDate, row.commuteDepartureTime),
          },
          driver: { fullName: row.driverFullName, profilePicture: row.driverProfilePicture },
          rider: {
            firstName: firstName(row.riderFullName),
            profilePicture: row.riderProfilePicture,
          },
        };
      }),
    };
  }

  // Whether a commute has trips still in play (pending, accepted or boarded) from date on.
  async hasActiveTripsFrom(commuteId: string, date: string) {
    const row = await this.table
      .where({ commuteId })
      .where("tripDate", ">=", date)
      .whereIn("status", ACTIVE_STATUSES)
      .first("id");
    return row !== undefined;
  }

  // Every trip on one date's run of a commute, soonest pickup first: the driver's manifest. Never the boarding
  // code, and a rider's phone only once their seat is confirmed (and only when showPhones).
  async listManifest({ commuteId, tripDate, status, showPhones, page, limit }: ManifestFilter) {
    const matching = () =>
      db("trips as t")
        .where({ "t.commuteId": commuteId, "t.tripDate": tripDate })
        .modify((query) => {
          if (status) query.where("t.status", status);
        });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .join("users as r", "r.id", "t.riderUserId")
        .select(
          "t.id",
          "t.status",
          "t.tripDate",
          "t.riderUserId",
          "r.fullName as riderFullName",
          "r.profilePicture as riderProfilePicture",
          "r.phoneCountryCode",
          "r.phoneNumber",
          "t.pickupAddress",
          "t.pickupLat",
          "t.pickupLng",
          "t.dropoffAddress",
          "t.dropoffLat",
          "t.dropoffLng",
          "t.scheduledPickupAt",
          "t.scheduledDropoffAt",
          "t.totalAmount",
          "t.driverEarnings",
          "t.heldAmount",
        )
        .orderBy([
          { column: "t.scheduledPickupAt", order: "asc" },
          { column: "t.id", order: "asc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<ManifestRow[]>,
    ]);

    return {
      totalItems: counted.total,
      items: rows.map((row) => ({
        tripId: row.id,
        status: row.status,
        tripDate: row.tripDate,
        rider: {
          id: row.riderUserId,
          fullName: row.riderFullName,
          profilePicture: row.riderProfilePicture,
          phone: showPhones && SEAT_STATUSES.includes(row.status) ? phoneOf(row) : null,
        },
        pickup: {
          address: row.pickupAddress,
          lat: Number(row.pickupLat),
          lng: Number(row.pickupLng),
        },
        dropoff: {
          address: row.dropoffAddress,
          lat: Number(row.dropoffLat),
          lng: Number(row.dropoffLng),
        },
        scheduledPickupAt: row.scheduledPickupAt,
        scheduledDropoffAt: row.scheduledDropoffAt,
        totalAmount: Number(row.totalAmount),
        driverEarnings: Number(row.driverEarnings),
        heldAmount: Number(row.heldAmount),
      })),
    };
  }

  private async assertSeatLeft(trx: Knex.Transaction, commuteId: string, tripDate: string) {
    if ((await this.seatsLeft(commuteId, tripDate, trx)) === 0) {
      throw AppError.conflict("This commute is full");
    }
  }

  private async insertIn(trx: Knex.Transaction, row: Partial<Trip>): Promise<Trip> {
    const [inserted] = await trx("trips")
      .insert({ ...row, fareBreakdown: JSON.stringify(row.fareBreakdown) })
      .returning("*");
    return this.sanitize(inserted);
  }

  private async lockIn(trx: Knex.Transaction, id: string): Promise<Trip> {
    const row = await trx("trips").where({ id }).forUpdate().first();
    if (!row) throw AppError.notFound(`Trip not found: ${id}`);
    return this.sanitize(row);
  }

  private async updateIn(trx: Knex.Transaction, id: string, fields: Partial<Trip>): Promise<Trip> {
    const [row] = await trx("trips")
      .where({ id })
      .update({ ...fields, updatedAt: new Date() })
      .returning("*");
    return this.sanitize(row);
  }
}

export const tripModel = new TripModel();
