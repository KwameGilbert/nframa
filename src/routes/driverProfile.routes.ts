import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  ownerFromUserIdBody,
  ownerFromUserIdParam,
  requireSelfOrPermission,
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
  requireSelfOrPermission(ownerFromUserIdBody, "users", "create"),
  createDriverProfile,
);

driverProfileRouter.get(
  "/driver/:userId",
  authenticate,
  validate({ params: driverProfileParamsSchema }),
  requireSelfOrPermission(ownerFromUserIdParam, "users", "read"),
  getDriverProfile,
);

driverProfileRouter.patch(
  "/driver/:userId",
  authenticate,
  validate({ params: driverProfileParamsSchema, body: updateDriverProfileSchema }),
  requireSelfOrPermission(ownerFromUserIdParam, "users", "update"),
  updateDriverProfile,
);
