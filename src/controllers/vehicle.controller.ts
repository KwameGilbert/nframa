import type { Request, Response } from "express";
import { vehicleModel } from "../models/vehicle.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../schemas/vehicle.schema.js";

export async function createVehicle(req: Request, res: Response) {
  const input = req.validated.body as CreateVehicleInput;

  const vehicle = await vehicleModel.createVehicle(input);

  sendCreated(res, vehicle);
}

export async function getVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const vehicle = await vehicleModel.findById(id);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }

  sendSuccess(res, vehicle);
}

export async function updateVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateVehicleInput;

  const vehicle = await vehicleModel.updateVehicle(id, input);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }

  sendSuccess(res, vehicle);
}
