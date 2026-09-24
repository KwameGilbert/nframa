import type { Request, Response } from "express";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateDriverProfileInput,
  UpdateDriverProfileInput,
} from "../schemas/driverProfile.schema.js";

export async function createDriverProfile(req: Request, res: Response) {
  const input = req.validated.body as CreateDriverProfileInput;

  const profile = await driverProfileModel.createProfile(input);

  sendCreated(res, "Driver profile created successfully", profile);
}

export async function getDriverProfile(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const profile = await driverProfileModel.findById(userId);

  if (!profile) {
    throw AppError.notFound(`Driver profile not found for user: ${userId}`);
  }

  sendSuccess(res, "Driver profile retrieved successfully", profile);
}

export async function updateDriverProfile(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const input = req.validated.body as UpdateDriverProfileInput;

  const profile = await driverProfileModel.updateProfile(userId, input);

  if (!profile) {
    throw AppError.notFound(`Driver profile not found for user: ${userId}`);
  }

  sendSuccess(res, "Driver profile updated successfully", profile);
}
