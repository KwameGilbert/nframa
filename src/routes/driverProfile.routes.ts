import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  ownerFromUserIdBody,
  ownerFromUserIdParam,
  requireSelfOrPermission,
  requirePermission,
} from "../middlewares/authorize.js";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  driverProfileParamsSchema,
} from "../schemas/driverProfile.schema.js";
import {
  listDrivers,
  createDriverProfile,
  getDriverProfile,
  getDriverByCode,
  getDriverByPhone,
  updateDriverProfile,
} from "../controllers/driverProfile.controller.js";

export const driverProfileRouter = Router();

driverProfileRouter.get("/drivers", authenticate, requirePermission("users", "read"), listDrivers);

driverProfileRouter.post(
  "/driver",
  authenticate,
  validate({ body: createDriverProfileSchema }),
  requireSelfOrPermission(ownerFromUserIdBody, "users", "create"),
  createDriverProfile,
);

driverProfileRouter.get(
  "/drivers/code/:code",
  authenticate,
  requirePermission("users", "read"),
  getDriverByCode,
);

driverProfileRouter.get(
  "/drivers/phone/:phoneCountryCode/:phoneNumber",
  authenticate,
  requirePermission("users", "read"),
  getDriverByPhone,
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
