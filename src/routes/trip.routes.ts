import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  tripActionLimit,
  tripBoardLimit,
  tripBrowseLimit,
  tripLocationLimit,
  tripRequestLimit,
} from "../middlewares/rateLimit.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  adminListTripsQuerySchema,
  availableTripsQuerySchema,
  boardTripSchema,
  cancelTripSchema,
  commuteTripsQuerySchema,
  createTripSchema,
  declineTripSchema,
  listTripsQuerySchema,
  tripIdParamsSchema,
  tripLocationSchema,
} from "../schemas/trip.schema.js";
import {
  acceptTrip,
  adminCancelTrip,
  adminGetTrip,
  adminListTrips,
  boardTrip,
  cancelTrip,
  completeTrip,
  declineTrip,
  getTrip,
  listAvailableTrips,
  listCommuteTrips,
  listTrips,
  markArrived,
  reportNoShow,
  requestTrip,
  shareTripLocation,
} from "../controllers/trip.controller.js";

export const tripRouter = Router();

// Admin routes for trips
tripRouter.get(
  "/admin/trips",
  authenticate,
  requirePermission("trips", "read"),
  validate({ query: adminListTripsQuerySchema }),
  adminListTrips,
);

tripRouter.get(
  "/admin/trips/:id",
  authenticate,
  requirePermission("trips", "read"),
  validate({ params: idParamsSchema }),
  adminGetTrip,
);

tripRouter.post(
  "/admin/trips/:tripId/cancel",
  authenticate,
  requirePermission("trips", "delete"),
  validate({ params: tripIdParamsSchema, body: cancelTripSchema }),
  adminCancelTrip,
);

// Who may do what depends on the caller's role and, for one trip, on whether they are its rider or driver,
// so the controller checks it.

// Before /trips/:id, which would otherwise take "available" as an id and 400 it.
tripRouter.get(
  "/trips/available",
  authenticate,
  tripBrowseLimit,
  validate({ query: availableTripsQuerySchema }),
  listAvailableTrips,
);

tripRouter.post(
  "/trips",
  authenticate,
  tripRequestLimit,
  validate({ body: createTripSchema }),
  requestTrip,
);

// By boarding code, not id: the driver scans it from the rider's phone.
tripRouter.post(
  "/trips/board",
  authenticate,
  tripBoardLimit,
  validate({ body: boardTripSchema }),
  boardTrip,
);

tripRouter.get(
  "/trips",
  authenticate,
  tripBrowseLimit,
  validate({ query: listTripsQuerySchema }),
  listTrips,
);

tripRouter.get("/trips/:id", authenticate, validate({ params: idParamsSchema }), getTrip);

tripRouter.post(
  "/trips/:id/cancel",
  authenticate,
  validate({ params: idParamsSchema, body: cancelTripSchema }),
  cancelTrip,
);

tripRouter.patch(
  "/trips/:id/accept",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema }),
  acceptTrip,
);

tripRouter.patch(
  "/trips/:id/decline",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema, body: declineTripSchema }),
  declineTrip,
);

tripRouter.put(
  "/trips/:id/location",
  authenticate,
  tripLocationLimit,
  validate({ params: idParamsSchema, body: tripLocationSchema }),
  shareTripLocation,
);

tripRouter.post(
  "/trips/:id/arrived",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema, body: tripLocationSchema }),
  markArrived,
);

tripRouter.post(
  "/trips/:id/complete",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema }),
  completeTrip,
);

tripRouter.post(
  "/trips/:id/no-show",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema }),
  reportNoShow,
);

// The driver's manifest: lives here rather than with the commute routes because it lists trips.
tripRouter.get(
  "/commutes/:id/trips",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema, query: commuteTripsQuerySchema }),
  listCommuteTrips,
);
