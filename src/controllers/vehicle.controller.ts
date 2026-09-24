import type { Request, Response } from "express";
import { vehicleModel } from "../models/vehicle.model.js";
import { assertSelfOrPermission } from "../middlewares/authorize.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../schemas/vehicle.schema.js";

// Loads the vehicle and checks the caller owns it (or has the admin permission) — the owner isn't in the
// request, so this can't be done in route middleware.
async function findVehicleFor(req: Request, id: string, action: "read" | "update") {
  const vehicle = await vehicleModel.findById(id);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }
  await assertSelfOrPermission(req, vehicle.carOwnerUserId, "users", action);

  return vehicle;
}

export async function createVehicle(req: Request, res: Response) {
  const input = req.validated.body as CreateVehicleInput;

  const vehicle = await vehicleModel.createVehicle(input);

  sendCreated(res, "Vehicle created successfully", vehicle);
}

export async function getVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const vehicle = await findVehicleFor(req, id, "read");

  sendSuccess(res, "Vehicle retrieved successfully", vehicle);
}

export async function updateVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateVehicleInput;

  await findVehicleFor(req, id, "update");
  const vehicle = await vehicleModel.updateVehicle(id, input);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }

  sendSuccess(res, "Vehicle updated successfully", vehicle);
}
