import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import {
  createRiderProfileSchema,
  riderProfileParamsSchema,
} from "../schemas/riderProfile.schema.js";
import { createRiderProfile, getRiderProfile } from "../controllers/riderProfile.controller.js";

export const riderProfileRouter = Router();

riderProfileRouter.post("/rider", validate({ body: createRiderProfileSchema }), createRiderProfile);
riderProfileRouter.get(
  "/rider/:userId",
  validate({ params: riderProfileParamsSchema }),
  getRiderProfile,
);
