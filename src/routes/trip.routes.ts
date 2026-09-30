import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { tripBrowseLimit, tripRequestLimit } from "../middlewares/rateLimit.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  availableTripsQuerySchema,
  cancelTripSchema,
  createTripSchema,
  listTripsQuerySchema,
} from "../schemas/trip.schema.js";
import {
  cancelTrip,
  getTrip,
  listAvailableTrips,
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
