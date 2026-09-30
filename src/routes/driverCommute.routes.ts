import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  createDriverCommuteSchema,
  driverCommuteParamsSchema,
  updateDriverCommuteSchema,
} from "../schemas/driverCommute.schema.js";
import {
  createDriverCommute,
  deleteDriverCommute,
  getDriverCommute,
  listDriverCommutes,
  updateDriverCommute,
} from "../controllers/driverCommute.controller.js";

export const driverCommuteRouter = Router();

// Ownership is checked in the controller: for list and create it depends on who the caller is and on the
// body, and for the rest it needs the loaded commute.
driverCommuteRouter.get("/commutes", authenticate, listDriverCommutes);

driverCommuteRouter.post(
  "/commutes",
  authenticate,
  validate({ body: createDriverCommuteSchema }),
  createDriverCommute,
);

driverCommuteRouter.get(
  "/commutes/:id",
  authenticate,
  validate({ params: driverCommuteParamsSchema }),
  getDriverCommute,
);

driverCommuteRouter.patch(
  "/commutes/:id",
  authenticate,
  validate({ params: driverCommuteParamsSchema, body: updateDriverCommuteSchema }),
  updateDriverCommute,
);

driverCommuteRouter.delete(
  "/commutes/:id",
  authenticate,
  validate({ params: driverCommuteParamsSchema }),
  deleteDriverCommute,
);
