import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createVehicleSchema, updateVehicleSchema } from "../schemas/vehicle.schema.js";
import { createVehicle, getVehicle, updateVehicle } from "../controllers/vehicle.controller.js";

export const vehicleRouter = Router();

vehicleRouter.post("/vehicles", validate({ body: createVehicleSchema }), createVehicle);
vehicleRouter.get("/vehicles/:id", validate({ params: idParamsSchema }), getVehicle);
vehicleRouter.patch(
  "/vehicles/:id",
  validate({ params: idParamsSchema, body: updateVehicleSchema }),
  updateVehicle,
);
