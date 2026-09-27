import type { Request, Response } from "express";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateDriverProfileInput,
  UpdateDriverProfileInput,
} from "../schemas/driverProfile.schema.js";

export async function listDrivers(_req: Request, res: Response) {
  const drivers = await driverProfileModel.findAllDriversWithRelations();

  sendSuccess(res, "Drivers retrieved successfully", drivers);
}

export async function createDriverProfile(req: Request, res: Response) {
  const input = req.validated.body as CreateDriverProfileInput;

  const profile = await driverProfileModel.createProfile(input);

  sendCreated(res, "Driver profile created successfully", profile);
}

export async function getDriverProfile(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const result = await driverProfileModel.findByIdWithRelations(userId);

  if (!result) {
    throw AppError.notFound(`Driver profile not found for user: ${userId}`);
  }

  sendSuccess(res, "Driver profile retrieved successfully", result);
}

export async function getDriverByCode(req: Request, res: Response) {
  const { code } = req.validated.params as { code: string };

  const result = await driverProfileModel.findByCode(code);

  if (!result) {
    throw AppError.notFound(`Driver not found with code: ${code}`);
  }

  sendSuccess(res, "Driver profile retrieved successfully", result);
}

export async function getDriverByPhone(req: Request, res: Response) {
  const { phoneCountryCode, phoneNumber } = req.validated.params as {
    phoneCountryCode: string;
    phoneNumber: string;
  };

  const result = await driverProfileModel.findByPhone(phoneCountryCode, phoneNumber);

  if (!result) {
    throw AppError.notFound(`Driver not found with phone: ${phoneCountryCode}${phoneNumber}`);
  }

  sendSuccess(res, "Driver profile retrieved successfully", result);
}

export async function updateDriverProfile(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const input = req.validated.body as UpdateDriverProfileInput;

  await driverProfileModel.updateProfile(userId, input);

  const result = await driverProfileModel.findByIdWithRelations(userId);

  if (!result) {
    throw AppError.notFound(`Driver profile not found for user: ${userId}`);
  }

  sendSuccess(res, "Driver profile updated successfully", result);
}
