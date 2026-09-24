import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  ownerFromUserIdBody,
  ownerFromUserIdParam,
  requireSelfOrAdmin,
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
  requireSelfOrAdmin(ownerFromUserIdBody),
  createRiderProfile,
);

riderProfileRouter.get(
  "/rider/:userId",
  authenticate,
  validate({ params: riderProfileParamsSchema }),
  requireSelfOrAdmin(ownerFromUserIdParam),
  getRiderProfile,
);
