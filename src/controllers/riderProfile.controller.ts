import type { Request, Response } from "express";
import { riderProfileModel } from "../models/riderProfile.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateRiderProfileInput } from "../schemas/riderProfile.schema.js";

export async function createRiderProfile(req: Request, res: Response) {
  const input = req.validated.body as CreateRiderProfileInput;

  const profile = await riderProfileModel.createProfile(input);

  sendCreated(res, profile);
}

export async function getRiderProfile(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const profile = await riderProfileModel.findById(userId);

  if (!profile) {
    throw AppError.notFound(`Rider profile not found for user: ${userId}`);
  }

  sendSuccess(res, profile);
}
