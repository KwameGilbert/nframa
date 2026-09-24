import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireSelfOrAdmin } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createVehicleSchema,
  updateVehicleSchema,
  type CreateVehicleInput,
} from "../schemas/vehicle.schema.js";
import { createVehicle, getVehicle, updateVehicle } from "../controllers/vehicle.controller.js";

export const vehicleRouter = Router();

vehicleRouter.post(
  "/vehicles",
  authenticate,
  validate({ body: createVehicleSchema }),
  requireSelfOrAdmin((req) => (req.validated.body as CreateVehicleInput).carOwnerUserId),
  createVehicle,
);

// The owner is only known once the vehicle is loaded, so the controller checks it.
vehicleRouter.get("/vehicles/:id", authenticate, validate({ params: idParamsSchema }), getVehicle);

vehicleRouter.patch(
  "/vehicles/:id",
  authenticate,
  validate({ params: idParamsSchema, body: updateVehicleSchema }),
  updateVehicle,
);
