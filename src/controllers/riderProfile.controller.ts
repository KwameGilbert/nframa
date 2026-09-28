import type { Request, Response } from "express";
import { riderProfileModel } from "../models/riderProfile.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateRiderProfileInput } from "../schemas/riderProfile.schema.js";

export async function createRiderProfile(req: Request, res: Response) {
  const input = req.validated.body as CreateRiderProfileInput;

  const profile = await riderProfileModel.createProfile(input);

  sendCreated(res, "Rider profile created successfully", profile);

  logActivity(req, {
    module: "riders",
    targetType: "rider",
    action: "rider.create",
    description: "Created a rider profile",
    targetId: input.userId,
    after: profile,
  });
}

export async function getRiderProfile(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const profile = await riderProfileModel.findById(userId);

  if (!profile) {
    throw AppError.notFound(`Rider profile not found for user: ${userId}`);
  }

  sendSuccess(res, "Rider profile retrieved successfully", profile);

  if (req.auth?.id !== userId) {
    logActivity(req, {
      module: "riders",
      targetType: "rider",
      action: "rider.view",
      description: "Viewed a rider profile",
      targetId: userId,
    });
  }
}
