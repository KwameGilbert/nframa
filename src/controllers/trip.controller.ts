import type { Request, Response } from "express";
import { publicTrip, tripModel, type Trip } from "../models/trip.model.js";
import { driverCommuteModel } from "../models/driverCommute.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { riderProfileModel } from "../models/riderProfile.model.js";
import { settingModel } from "../models/setting.model.js";
import { userModel } from "../models/user.model.js";
import { walletModel } from "../models/wallet.model.js";
import { assertPermission } from "../middlewares/authorize.js";
import { findCommuteFor } from "./driverCommute.controller.js";
import { logActivity } from "../services/activityLog.service.js";
import { calculateFare, getFareSettings } from "../services/fare.service.js";
import {
  distanceToSegmentMeters,
  haversineMeters,
  progressAlong,
  type Point,
} from "../services/geo.js";
import { commuteRoute, getRoute } from "../services/maps.service.js";
import { emitToUser } from "../services/socket.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import { addDays, departureAt, isoWeekday, timeOfDay, today } from "../utils/tripTime.js";
import type {
  AvailableTripsQuery,
  BoardTripInput,
  CancelTripInput,
  CommuteTripsQuery,
  CreateTripInput,
  DeclineTripInput,
  ListTripsQuery,
  TripLocationInput,
} from "../schemas/trip.schema.js";

const TRIP_ACTIVITY = { module: "trips", targetType: "trip" } as const;

// Once a seat is confirmed the rider may call the driver and look for the plate.
const CONFIRMED_STATUSES = new Set(["accepted", "boarded", "completed"]);

type TripDetail = NonNullable<Awaited<ReturnType<typeof tripModel.findDetail>>>;

function riderOnly(req: Request, action: string): string {
  if (req.auth?.role !== "rider") {
    throw AppError.forbidden(`Only riders can ${action}`);
  }
  return req.auth.id;
}

// Riders book from today up to trips.bookingWindowDays ahead (service time).
function assertBookableDate(date: string, windowDays: number, now: Date) {
  if (date < today(now)) {
    throw AppError.badRequest("The date can't be in the past");
  }
  if (date > addDays(today(now), windowDays)) {
    throw AppError.badRequest(`Trips can be booked at most ${windowDays} days ahead`);
  }
}

function paginated<T>(
  items: T[],
  totalItems: number,
  { page, limit }: { page: number; limit: number },
) {
  return {
    items,
    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
  };
}

const toProgress = (value: number) => Math.round(value * 10_000) / 10_000;

type RunRider = TripDetail["riders"][number];

// Each rider's pickup and drop-off, in route order (stored progress along the commute).
function stopsOf(riders: RunRider[]) {
  return riders
    .flatMap((rider) =>
      (["pickup", "dropoff"] as const).map((type) => ({ type, rider, point: rider[type] })),
    )
    .sort((a, b) => a.point.progress - b.point.progress);
}

// What viewerId may see of a trip: the boarding code is the rider's alone, and the phones (the driver's to the
// rider, the rider's to the driver) and the plate only show once the seat is confirmed. Until then the rider sees
// only their own stops, not who else rides or where they're picked up, so a request can't be used to look at other
// riders. viewerId null is the audit-trail copy, with neither code nor phone.
function tripView(detail: TripDetail, viewerId: string | null) {
  const { trip, commute, driver, rider, vehicle, seatsLeft } = detail;
  const isRider = viewerId === trip.riderUserId;
  const isDriver = viewerId === trip.driverUserId;
  const confirmed = CONFIRMED_STATUSES.has(trip.status);
  const riders = isRider && !confirmed ? [ownRun(trip)] : detail.riders;

  return {
    ...publicTrip(trip),
    boardingCode: isRider ? trip.boardingCode : null,
    commute,
    driver: {
      fullName: driver.fullName,
      profilePicture: driver.profilePicture,
      phone: isRider && confirmed ? driver.phone : null,
    },
    rider: { ...rider, phone: isDriver && confirmed ? rider.phone : null },
    vehicle: vehicle && { ...vehicle, plate: confirmed ? vehicle.plate : null },
    seatsLeft,
    otherCommuters: riders
      .filter((other) => other.tripId !== trip.id)
      .map(({ firstName, profilePicture }) => ({ firstName, profilePicture })),
    stops: stopsOf(riders).map(({ type, rider: stopRider, point }) => ({
      type,
      address: point.address,
      lat: point.lat,
      lng: point.lng,
      scheduledAt: point.scheduledAt,
      isYou: stopRider.tripId === trip.id,
    })),
  };
}

// The trip's own pickup and drop-off, shaped like one of findDetail's riders.
function ownRun(trip: TripDetail["trip"]): RunRider {
  return {
    tripId: trip.id,
    firstName: null,
    profilePicture: null,
    pickup: {
      address: trip.pickupAddress,
      lat: trip.pickupLat,
      lng: trip.pickupLng,
      progress: trip.pickupProgress,
      scheduledAt: trip.scheduledPickupAt,
    },
    dropoff: {
      address: trip.dropoffAddress,
      lat: trip.dropoffLat,
      lng: trip.dropoffLng,
      progress: trip.dropoffProgress,
      scheduledAt: trip.scheduledDropoffAt,
    },
  };
}

// Loads a trip for its rider, its driver, or an admin with trips: read. Stale pending requests expire first, so
// the status shown is current.
async function findTripFor(req: Request, id: string): Promise<TripDetail> {
  await tripModel.settleStale({ id });
  const detail = await tripModel.findDetail(id);
  if (!detail) {
    throw AppError.notFound(`Trip not found: ${id}`);
  }
  const { riderUserId, driverUserId } = detail.trip;
  if (req.auth?.id !== riderUserId && req.auth?.id !== driverUserId) {
    await assertPermission(req, "trips", "read");
  }
  return detail;
}

// Loads a trip for its driver to act on, once stale trips are settled (an overdue request expired, ...), so the
// status seen here, and re-checked under the lock in the model, is current.
async function findTripForDriver(req: Request, id: string, action: string): Promise<TripDetail> {
  await tripModel.settleStale({ id });
  const detail = await tripModel.findDetail(id);
  if (!detail) {
    throw AppError.notFound(`Trip not found: ${id}`);
  }
  if (req.auth?.role !== "driver" || req.auth.id !== detail.trip.driverUserId) {
    throw AppError.forbidden(`Only the trip's driver can ${action} it`);
  }
  return detail;
}

const BOARDING_SETTINGS = [
  "trips.boardingRadiusMeters",
  "trips.locationMaxAgeSeconds",
  "trips.boardingEarlyMinutes",
  "trips.boardingLateMinutes",
  "fares.waitGraceMinutes",
  "fares.waitPerMinuteRate",
] as const;

type BoardingSettings = Awaited<ReturnType<typeof boardingSettings>>;

const boardingSettings = () => settingModel.getValues(BOARDING_SETTINGS);

// The driver can mark arrival and scan the rider from trips.boardingEarlyMinutes before the scheduled pickup to
// trips.boardingLateMinutes after it. Deliberately not tied to tripDate: a pickup can fall after midnight.
function assertBoardingWindow(trip: Trip, s: BoardingSettings, now: Date) {
  const pickup = trip.scheduledPickupAt.getTime();
  const opens = new Date(pickup - s["trips.boardingEarlyMinutes"] * 60_000);
  const closes = new Date(pickup + s["trips.boardingLateMinutes"] * 60_000);
  if (now < opens) throw AppError.conflict(`Boarding opens at ${opens.toISOString()}`);
  if (now > closes) throw AppError.conflict(`Boarding closed at ${closes.toISOString()}`);
}

function assertNearPickup(trip: Trip, driverAt: Point, s: BoardingSettings) {
  const pickup = { lat: trip.pickupLat, lng: trip.pickupLng };
  if (haversineMeters(driverAt, pickup) > s["trips.boardingRadiusMeters"]) {
    throw AppError.conflict("You're too far from the pickup point");
  }
}

// Proof the rider is in the car: their app's last location is fresh and within the radius of the driver.
function assertRiderWithDriver(trip: Trip, driverAt: Point, s: BoardingSettings, now: Date) {
  const { riderLat, riderLng, riderLocationAt } = trip;
  const maxAgeMs = s["trips.locationMaxAgeSeconds"] * 1000;
  if (
    riderLat === null ||
    riderLng === null ||
    !riderLocationAt ||
    now.getTime() - riderLocationAt.getTime() > maxAgeMs
  ) {
    throw AppError.conflict("The rider's location is out of date: ask them to open the app");
  }
  const riderAt = { lat: riderLat, lng: riderLng };
  if (haversineMeters(riderAt, driverAt) > s["trips.boardingRadiusMeters"]) {
    throw AppError.conflict("The rider isn't close enough to the vehicle");
  }
}

const tripEvent = ({ trip }: TripDetail) => ({
  tripId: trip.id,
  commuteId: trip.commuteId,
  tripDate: trip.tripDate,
  status: trip.status,
});

export async function listAvailableTrips(req: Request, res: Response) {
  const riderId = riderOnly(req, "browse trips");
  const query = req.validated.query as AvailableTripsQuery;
  const now = new Date();

  const settings = await settingModel.getValues([
    "trips.bookingWindowDays",
    "trips.availabilityRadiusKm",
  ]);
  assertBookableDate(query.date, settings["trips.bookingWindowDays"], now);

  const { items, totalItems } = await tripModel.listAvailable({
    ...query,
    radiusMeters: settings["trips.availabilityRadiusKm"] * 1000,
    excludeUserId: riderId,
    departsAfter: query.date === today(now) ? timeOfDay(now) : undefined,
  });

  sendSuccess(res, "Available trips retrieved successfully", paginated(items, totalItems, query));
}

export async function requestTrip(req: Request, res: Response) {
  const riderId = riderOnly(req, "request trips");
  const input = req.validated.body as CreateTripInput;

  if (!(await riderProfileModel.findById(riderId))) {
    throw AppError.badRequest("Create your rider profile before requesting trips");
  }

  const commute = await driverCommuteModel.findById(input.commuteId);
  if (!commute) {
    throw AppError.notFound(`Commute not found: ${input.commuteId}`);
  }
  const [driverProfile, driver] = await Promise.all([
    driverProfileModel.findById(commute.userId),
    userModel.findById(commute.userId),
  ]);
  const driverCanDrive =
    driverProfile?.verificationStatus === "approved" &&
    driver?.status === "active" &&
    !driver.deletedAt;
  if (!commute.isActive || !driverProfile || !driverCanDrive) {
    throw AppError.conflict("This commute is not taking bookings");
  }
  if (commute.userId === riderId) {
    throw AppError.badRequest("You can't book your own commute");
  }

  const settings = await settingModel.getValues([
    "trips.bookingWindowDays",
    "trips.routeToleranceKm",
    "trips.requestExpiryMinutes",
  ]);
  if (!commute.recurrenceDays.includes(isoWeekday(input.tripDate))) {
    throw AppError.badRequest(`This commute doesn't run on ${input.tripDate}`);
  }
  const now = new Date();
  assertBookableDate(input.tripDate, settings["trips.bookingWindowDays"], now);

  const start = { lat: commute.startLat, lng: commute.startLng };
  const end = { lat: commute.endLat, lng: commute.endLng };
  const toleranceKm = settings["trips.routeToleranceKm"];
  for (const [label, point] of [
    ["Pickup", input.pickup],
    ["Drop-off", input.dropoff],
  ] as const) {
    if (distanceToSegmentMeters(point, start, end) > toleranceKm * 1000) {
      throw AppError.badRequest(`${label} is more than ${toleranceKm} km from the commute's route`);
    }
  }
  // Rounded to what the database stores, which requires pickup strictly before drop-off.
  const pickupProgress = toProgress(progressAlong(input.pickup, start, end));
  const dropoffProgress = toProgress(progressAlong(input.dropoff, start, end));
  if (pickupProgress >= dropoffProgress) {
    throw AppError.badRequest(
      "Drop-off must come after pickup in the commute's direction of travel",
    );
  }

  // Commutes created before routes were stored have none: work it out once and keep it.
  let commuteSeconds = commute.durationSeconds;
  if (commuteSeconds === null) {
    const route = await commuteRoute(commute);
    await driverCommuteModel.updateById(commute.id, route);
    commuteSeconds = route.durationSeconds;
  }
  const leaves = departureAt(input.tripDate, commute.departureTime).getTime();
  const at = (progress: number) => new Date(leaves + Math.round(progress * commuteSeconds) * 1000);
  const scheduledPickupAt = at(pickupProgress);
  const scheduledDropoffAt = at(dropoffProgress);
  if (scheduledPickupAt <= now) {
    throw AppError.badRequest("This trip's pickup time has already passed");
  }

  const [leg, fareSettings] = await Promise.all([
    getRoute(input.pickup, input.dropoff),
    getFareSettings(),
  ]);
  const fareBreakdown = calculateFare(leg, fareSettings);
  // Only possible with every fare and fee setting at zero; a hold must be for a positive amount.
  if (!(fareBreakdown.total > 0)) {
    throw AppError.serviceUnavailable("Fares are not configured");
  }

  // Settled first: a stale trip's hold, once released, counts toward the balance.
  await tripModel.settleStale({ riderUserId: riderId });
  if ((await walletModel.getAvailableBalance(riderId)) < fareBreakdown.total) {
    throw AppError.conflict("Insufficient wallet balance");
  }
  const overlapping = await tripModel.hasOverlappingTrip(riderId, {
    commuteId: commute.id,
    from: scheduledPickupAt,
    to: scheduledDropoffAt,
  });
  if (overlapping) {
    throw AppError.conflict("You already have a trip at that time");
  }

  // Refused up front even for a pending request, which takes no seat: it could never be accepted. An auto-accept
  // re-counts under the commute lock.
  if ((await tripModel.seatsLeft(commute.id, input.tripDate)) === 0) {
    throw AppError.conflict("This commute is full");
  }

  const expiresAt = new Date(
    Math.min(
      now.getTime() + settings["trips.requestExpiryMinutes"] * 60_000,
      scheduledPickupAt.getTime(),
    ),
  );
  const created = await tripModel.createTrip(
    {
      commuteId: commute.id,
      riderUserId: riderId,
      driverUserId: commute.userId,
      tripDate: input.tripDate,
      pickupAddress: input.pickup.address,
      pickupLat: input.pickup.lat,
      pickupLng: input.pickup.lng,
      dropoffAddress: input.dropoff.address,
      dropoffLat: input.dropoff.lat,
      dropoffLng: input.dropoff.lng,
      pickupProgress,
      dropoffProgress,
      distanceMeters: leg.distanceMeters,
      durationSeconds: leg.durationSeconds,
      scheduledPickupAt,
      scheduledDropoffAt,
      expiresAt,
      fare: fareBreakdown.fare,
      platformFee: fareBreakdown.platformFee,
      bookingFee: fareBreakdown.bookingFee,
      totalAmount: fareBreakdown.total,
      driverEarnings: fareBreakdown.driverEarnings,
      fareBreakdown,
    },
    { autoAccept: driverProfile.autoAcceptBookings },
  );
  const detail = (await tripModel.findDetail(created.id)) as TripDetail;
  const accepted = created.status === "accepted";

  sendCreated(
    res,
    accepted ? "Trip booked successfully" : "Trip requested successfully",
    tripView(detail, riderId),
  );

  emitToUser(commute.userId, "trip:requested", tripEvent(detail));
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.request",
    description: accepted ? "Booked a trip (accepted automatically)" : "Requested a trip",
    targetId: created.id,
    after: tripView(detail, null),
  });
}

export async function listTrips(req: Request, res: Response) {
  const role = req.auth?.role;
  if (!req.auth || (role !== "rider" && role !== "driver")) {
    throw AppError.forbidden("Only riders and drivers have trips");
  }
  const userId = req.auth.id;
  const query = req.validated.query as ListTripsQuery;

  await tripModel.settleStale(
    role === "rider" ? { riderUserId: userId } : { driverUserId: userId },
  );
  const { items, totalItems } = await tripModel.listForUser({ ...query, userId, as: role });

  sendSuccess(res, "Trips retrieved successfully", paginated(items, totalItems, query));
}

export async function getTrip(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const detail = await findTripFor(req, id);

  sendSuccess(res, "Trip retrieved successfully", tripView(detail, req.auth?.id ?? null));
}

export async function cancelTrip(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { reason } = req.validated.body as CancelTripInput;

  await tripModel.settleStale({ id });
  const before = await tripModel.findDetail(id);
  if (!before) {
    throw AppError.notFound(`Trip not found: ${id}`);
  }
  const { riderUserId, driverUserId } = before.trip;
  const callerId = req.auth?.id;
  const by = callerId === riderUserId ? "rider" : callerId === driverUserId ? "driver" : null;
  if (!by) {
    throw AppError.forbidden("Only the trip's rider or driver can cancel it");
  }

  await tripModel.cancelTrip(id, { by, reason });
  const after = (await tripModel.findDetail(id)) as TripDetail;

  sendSuccess(res, "Trip cancelled successfully", tripView(after, callerId ?? null));

  emitToUser(by === "rider" ? driverUserId : riderUserId, "trip:cancelled", {
    ...tripEvent(after),
    cancelledBy: by,
    reason: after.trip.cancellationReason,
  });
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.cancel",
    description: `Cancelled a trip (as the ${by})`,
    targetId: id,
    before: tripView(before, null),
    after: tripView(after, null),
  });
}

export async function acceptTrip(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const before = await findTripForDriver(req, id, "accept");
  await tripModel.acceptWithHold(id);
  const after = (await tripModel.findDetail(id)) as TripDetail;

  sendSuccess(res, "Trip accepted successfully", tripView(after, before.trip.driverUserId));

  emitToUser(after.trip.riderUserId, "trip:accepted", tripEvent(after));
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.accept",
    description: "Accepted a trip request",
    targetId: id,
    before: tripView(before, null),
    after: tripView(after, null),
  });
}

export async function declineTrip(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { reason } = req.validated.body as DeclineTripInput;

  const before = await findTripForDriver(req, id, "decline");
  await tripModel.declineTrip(id, reason);
  const after = (await tripModel.findDetail(id)) as TripDetail;

  sendSuccess(res, "Trip declined successfully", tripView(after, before.trip.driverUserId));

  emitToUser(after.trip.riderUserId, "trip:declined", {
    ...tripEvent(after),
    reason: after.trip.cancellationReason,
  });
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.decline",
    description: "Declined a trip request",
    targetId: id,
    before: tripView(before, null),
    after: tripView(after, null),
  });
}

// The driver's manifest for one date's run: every trip on it, plus the seats and the route sheet of confirmed
// stops (with first names, since the driver has to find each rider).
export async function listCommuteTrips(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { date = today(), ...query } = req.validated.query as CommuteTripsQuery;

  const commute = await findCommuteFor(req, id, "read");
  await tripModel.settleStale({ commuteId: id });
  const [{ items, totalItems }, riders, seatsLeft] = await Promise.all([
    tripModel.listManifest({
      ...query,
      commuteId: id,
      tripDate: date,
      showPhones: req.auth?.id === commute.userId,
    }),
    tripModel.ridersOnRun(id, date),
    tripModel.seatsLeft(id, date),
  ]);

  sendSuccess(res, "Commute trips retrieved successfully", {
    commuteId: id,
    date,
    departureAt: departureAt(date, commute.departureTime),
    capacity: commute.capacity,
    seatsLeft,
    stops: stopsOf(riders).map(({ type, rider, point }) => ({
      type,
      tripId: rider.tripId,
      firstName: rider.firstName,
      address: point.address,
      lat: point.lat,
      lng: point.lng,
      scheduledAt: point.scheduledAt,
    })),
    ...paginated(items, totalItems, query),
  });
}

// The rider's app reports where they are while waiting for the pickup, for the boarding scan to check.
export async function shareTripLocation(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const point = req.validated.body as TripLocationInput;

  const trip = await tripModel.findById(id);
  if (!trip) {
    throw AppError.notFound(`Trip not found: ${id}`);
  }
  if (req.auth?.id !== trip.riderUserId) {
    throw AppError.forbidden("Only the trip's rider can share their location for it");
  }
  if (trip.status !== "accepted") {
    throw AppError.conflict(`Can't share your location for a trip that is ${trip.status}`);
  }
  const earlyMinutes = await settingModel.getValue("trips.boardingEarlyMinutes");
  const opens = new Date(trip.scheduledPickupAt.getTime() - earlyMinutes * 60_000);
  if (new Date() < opens) {
    throw AppError.conflict(`You can share your location from ${opens.toISOString()}`);
  }
  const location = await tripModel.shareRiderLocation(id, point);

  sendSuccess(res, "Location shared successfully", location);
}

export async function markArrived(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const driverAt = req.validated.body as TripLocationInput;

  const before = await findTripForDriver(req, id, "mark arrival for");
  // A repeat mark changes nothing, so it isn't checked again; any status but accepted is refused in the model.
  if (before.trip.status === "accepted" && !before.trip.arrivedAt) {
    const settings = await boardingSettings();
    assertBoardingWindow(before.trip, settings, new Date());
    assertNearPickup(before.trip, driverAt, settings);
  }
  const { changed } = await tripModel.markArrived(id);
  const after = (await tripModel.findDetail(id)) as TripDetail;

  sendSuccess(res, "Arrival marked successfully", tripView(after, before.trip.driverUserId));
  if (!changed) return;

  emitToUser(after.trip.riderUserId, "trip:driver_arrived", {
    ...tripEvent(after),
    arrivedAt: after.trip.arrivedAt,
  });
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.arrive",
    description: "Arrived at the pickup point",
    targetId: id,
    before: tripView(before, null),
    after: tripView(after, null),
  });
}

// The driver scans the rider's boarding code. Checks, in order: the code is on one of the caller's trips (anything
// else is the same 404, so codes can't be probed), the trip is accepted and today, inside the boarding window, the
// driver near the pickup, and the rider's shared location fresh and near the driver.
export async function boardTrip(req: Request, res: Response) {
  if (req.auth?.role !== "driver") {
    throw AppError.forbidden("Only drivers can board riders");
  }
  const driverId = req.auth.id;
  const { code, ...driverAt } = req.validated.body as BoardTripInput;

  const found = await tripModel.findByBoardingCode(code, driverId);
  if (!found) {
    throw AppError.notFound("No trip found for that code");
  }
  await tripModel.settleStale({ id: found.id });
  const before = (await tripModel.findDetail(found.id)) as TripDetail;
  const { trip } = before;
  if (trip.status !== "accepted") {
    throw AppError.conflict(`Can't board a trip that is ${trip.status}`);
  }
  const settings = await boardingSettings();
  const now = new Date();
  assertBoardingWindow(trip, settings, now);
  assertNearPickup(trip, driverAt, settings);
  assertRiderWithDriver(trip, driverAt, settings, now);

  await tripModel.boardTrip(trip.id, driverAt, settings);
  const after = (await tripModel.findDetail(trip.id)) as TripDetail;

  sendSuccess(res, "Rider boarded successfully", tripView(after, driverId));

  emitToUser(trip.riderUserId, "trip:boarded", {
    ...tripEvent(after),
    boardedAt: after.trip.boardedAt,
    waitMinutes: after.trip.waitMinutes,
    waitCharge: after.trip.waitCharge,
  });
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.board",
    description: "Boarded a rider",
    targetId: trip.id,
    redact: ["code"],
    before: tripView(before, null),
    after: tripView(after, null),
  });
}

export async function completeTrip(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const before = await findTripForDriver(req, id, "complete");
  await tripModel.completeTrip(id);
  const after = (await tripModel.findDetail(id)) as TripDetail;

  sendSuccess(res, "Trip completed successfully", tripView(after, before.trip.driverUserId));

  emitToUser(after.trip.riderUserId, "trip:completed", {
    ...tripEvent(after),
    completedAt: after.trip.completedAt,
  });
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.complete",
    description: "Completed a trip",
    targetId: id,
    before: tripView(before, null),
    after: tripView(after, null),
  });
}

// Only once the boarding window has closed: until then the rider can still be scanned.
export async function reportNoShow(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const before = await findTripForDriver(req, id, "report a no-show for");
  if (before.trip.status === "accepted") {
    const lateMinutes = await settingModel.getValue("trips.boardingLateMinutes");
    const opens = new Date(before.trip.scheduledPickupAt.getTime() + lateMinutes * 60_000);
    if (new Date() < opens) {
      throw AppError.conflict(`You can report a no-show from ${opens.toISOString()}`);
    }
  }
  await tripModel.reportNoShow(id, "driver");
  const after = (await tripModel.findDetail(id)) as TripDetail;

  sendSuccess(res, "No-show reported successfully", tripView(after, before.trip.driverUserId));

  emitToUser(after.trip.riderUserId, "trip:no_show", {
    ...tripEvent(after),
    reason: after.trip.cancellationReason,
  });
  logActivity(req, {
    ...TRIP_ACTIVITY,
    action: "trip.no_show",
    description: "Reported that the rider didn't show up",
    targetId: id,
    before: tripView(before, null),
    after: tripView(after, null),
  });
}
