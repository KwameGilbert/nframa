import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { estimateFareSchema } from "../schemas/fare.schema.js";
import { estimateFare } from "../controllers/fare.controller.js";

export const fareRouter = Router();

// authenticate only, on purpose: an estimate is a calculation over the request's own coordinates and exposes
// no stored data, so any signed-in user may call it.
fareRouter.post(
  "/fares/estimate",
  authenticate,
  validate({ body: estimateFareSchema }),
  estimateFare,
);
