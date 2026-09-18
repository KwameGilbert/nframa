import { Router } from "express";
import { validate } from "../middlewares/validate.js";
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
  validate({ body: createDriverProfileSchema }),
  createDriverProfile,
);
driverProfileRouter.get(
  "/driver/:userId",
  validate({ params: driverProfileParamsSchema }),
  getDriverProfile,
);
driverProfileRouter.patch(
  "/driver/:userId",
  validate({ params: driverProfileParamsSchema, body: updateDriverProfileSchema }),
  updateDriverProfile,
);
