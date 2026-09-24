import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  ownerFromUserIdBody,
  ownerFromUserIdParam,
  requireSelfOrPermission,
} from "../middlewares/authorize.js";
import {
  createRiderProfileSchema,
  riderProfileParamsSchema,
} from "../schemas/riderProfile.schema.js";
import { createRiderProfile, getRiderProfile } from "../controllers/riderProfile.controller.js";

export const riderProfileRouter = Router();

riderProfileRouter.post(
  "/rider",
  authenticate,
  validate({ body: createRiderProfileSchema }),
  requireSelfOrPermission(ownerFromUserIdBody, "users", "create"),
  createRiderProfile,
);

riderProfileRouter.get(
  "/rider/:userId",
  authenticate,
  validate({ params: riderProfileParamsSchema }),
  requireSelfOrPermission(ownerFromUserIdParam, "users", "read"),
  getRiderProfile,
);
