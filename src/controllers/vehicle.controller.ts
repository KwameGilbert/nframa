import type { Request, Response } from "express";
import { vehicleModel } from "../models/vehicle.model.js";
import { isSelfOrAdmin } from "../middlewares/authorize.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../schemas/vehicle.schema.js";

// Loads the vehicle and checks the caller owns it (or is an admin) — the owner isn't in the request.
async function findOwnedVehicle(req: Request, id: string) {
  const vehicle = await vehicleModel.findById(id);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }
  if (!isSelfOrAdmin(req, vehicle.carOwnerUserId)) {
    throw AppError.forbidden("You do not have permission to perform this action");
  }

  return vehicle;
}

export async function createVehicle(req: Request, res: Response) {
  const input = req.validated.body as CreateVehicleInput;

  const vehicle = await vehicleModel.createVehicle(input);

  sendCreated(res, vehicle);
}

export async function getVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const vehicle = await findOwnedVehicle(req, id);

  sendSuccess(res, vehicle);
}

export async function updateVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateVehicleInput;

  await findOwnedVehicle(req, id);
  const vehicle = await vehicleModel.updateVehicle(id, input);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }

  sendSuccess(res, vehicle);
}
