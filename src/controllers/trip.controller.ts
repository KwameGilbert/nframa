import type { Request, Response } from "express";
import { publicTrip, tripModel } from "../models/trip.model.js";
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
import { distanceToSegmentMeters, progressAlong } from "../services/geo.js";
import { commuteRoute, getRoute } from "../services/maps.service.js";
import { emitToUser } from "../services/socket.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import { addDays, departureAt, isoWeekday, timeOfDay, today } from "../utils/tripTime.js";
import type {
  AvailableTripsQuery,
  CancelTripInput,
  CommuteTripsQuery,
  CreateTripInput,
  DeclineTripInput,
  ListTripsQuery,
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
  await tripModel.expireStale({ id });
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

// Loads a trip for its driver to answer. A stale pending request is then expired, so the locked re-check in the
// model refuses it by its status.
async function findTripForDriver(req: Request, id: string, action: string): Promise<TripDetail> {
  const detail = await tripModel.findDetail(id);
  if (!detail) {
    throw AppError.notFound(`Trip not found: ${id}`);
  }
  if (req.auth?.role !== "driver" || req.auth.id !== detail.trip.driverUserId) {
    throw AppError.forbidden(`Only the trip's driver can ${action} it`);
  }
  await tripModel.expireStale({ id });
  return detail;
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

  if ((await walletModel.getAvailableBalance(riderId)) < fareBreakdown.total) {
    throw AppError.conflict("Insufficient wallet balance");
  }
  await tripModel.expireStale({ riderUserId: riderId });
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

  await tripModel.expireStale(
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

  await tripModel.expireStale({ id });
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
  await tripModel.expireStale({ commuteId: id });
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
