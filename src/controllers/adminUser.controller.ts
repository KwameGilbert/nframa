import type { Request, Response } from "express";
import { adminUserModel } from "../models/adminUser.model.js";
import { userModel } from "../models/user.model.js";
import { hashPassword } from "../utils/password.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateAdminUserInput, UpdateAdminUserInput } from "../schemas/adminUser.schema.js";

export async function createAdminUser(req: Request, res: Response) {
  const { password, ...input } = req.validated.body as CreateAdminUserInput;

  const adminUser = await adminUserModel.createAdminUser(input);

  // The password lives on the users row, not the admin extension record.
  if (password) {
    await userModel.setPassword(adminUser.userId, await hashPassword(password));
  }

  sendCreated(res, adminUser);
}

export async function getAdminUser(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const adminUser = await adminUserModel.findById(userId);

  if (!adminUser) {
    throw AppError.notFound(`Admin user not found for user: ${userId}`);
  }

  sendSuccess(res, adminUser);
}

export async function updateAdminUser(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const input = req.validated.body as UpdateAdminUserInput;

  const adminUser = await adminUserModel.updateAdminUser(userId, input);

  if (!adminUser) {
    throw AppError.notFound(`Admin user not found for user: ${userId}`);
  }

  sendSuccess(res, adminUser);
}
