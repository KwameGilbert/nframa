import type { Request, Response } from "express";
import { adminUserModel } from "../models/adminUser.model.js";
import { userModel } from "../models/user.model.js";
import { hashPassword } from "../utils/password.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import { findUserOrThrow, softDeleteAccount } from "./user.controller.js";
import type { CreateAdminUserInput, UpdateAdminUserInput } from "../schemas/adminUser.schema.js";

export async function createAdminUser(req: Request, res: Response) {
  const { password, ...input } = req.validated.body as CreateAdminUserInput;

  const adminUser = await adminUserModel.createAdminUser(input);

  // The password lives on the users row, not the admin extension record.
  if (password) {
    await userModel.setPassword(adminUser.userId, await hashPassword(password));
  }

  sendCreated(res, "Admin user created successfully", adminUser);
}

export async function getAdminUser(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const adminUser = await adminUserModel.findById(userId);

  if (!adminUser) {
    throw AppError.notFound(`Admin user not found for user: ${userId}`);
  }

  sendSuccess(res, "Admin user retrieved successfully", adminUser);
}

export async function updateAdminUser(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const input = req.validated.body as UpdateAdminUserInput;

  // Stops an admin locking themselves out, e.g. the only super admin moving to a lesser role.
  if (req.auth?.id === userId && (input.roleId !== undefined || input.status !== undefined)) {
    throw AppError.forbidden("You can't change your own role or status");
  }

  const adminUser = await adminUserModel.updateAdminUser(userId, input);

  if (!adminUser) {
    throw AppError.notFound(`Admin user not found for user: ${userId}`);
  }

  sendSuccess(res, "Admin user updated successfully", adminUser);
}

// Soft-deletes the admin's user account (the admin record is kept for history). Same guards as
// DELETE /users/:id on an admin: not yourself, and only a system-role admin can delete a system-role admin.
export async function deleteAdminUser(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };

  const adminUser = await adminUserModel.findById(userId);
  if (!adminUser) {
    throw AppError.notFound(`Admin user not found for user: ${userId}`);
  }

  await softDeleteAccount(req, await findUserOrThrow(userId));

  sendSuccess(res, "Admin user deleted successfully", adminUser);
}
