import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { tripActionLimit, tripBrowseLimit, tripRequestLimit } from "../middlewares/rateLimit.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  availableTripsQuerySchema,
  cancelTripSchema,
  commuteTripsQuerySchema,
  createTripSchema,
  declineTripSchema,
  listTripsQuerySchema,
} from "../schemas/trip.schema.js";
import {
  acceptTrip,
  cancelTrip,
  declineTrip,
  getTrip,
  listAvailableTrips,
  listCommuteTrips,
  listTrips,
  requestTrip,
} from "../controllers/trip.controller.js";

export const tripRouter = Router();

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

// The driver's manifest: lives here rather than with the commute routes because it lists trips.
tripRouter.get(
  "/commutes/:id/trips",
  authenticate,
  tripActionLimit,
  validate({ params: idParamsSchema, query: commuteTripsQuerySchema }),
  listCommuteTrips,
);
