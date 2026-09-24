import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  ownerFromUserIdBody,
  ownerFromUserIdParam,
  requireSelfOrAdmin,
} from "../middlewares/authorize.js";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  driverProfileParamsSchema,
} from "../schemas/driverProfile.schema.js";
import {
  createDriverProfile,
  getDriverProfile,
  updateDriverProfile,
} from "../controllers/driverProfile.controller.js";

export const driverProfileRouter = Router();

driverProfileRouter.post(
  "/driver",
  authenticate,
  validate({ body: createDriverProfileSchema }),
  requireSelfOrAdmin(ownerFromUserIdBody),
  createDriverProfile,
);

driverProfileRouter.get(
  "/driver/:userId",
  authenticate,
  validate({ params: driverProfileParamsSchema }),
  requireSelfOrAdmin(ownerFromUserIdParam),
  getDriverProfile,
);

driverProfileRouter.patch(
  "/driver/:userId",
  authenticate,
  validate({ params: driverProfileParamsSchema, body: updateDriverProfileSchema }),
  requireSelfOrAdmin(ownerFromUserIdParam),
  updateDriverProfile,
);
