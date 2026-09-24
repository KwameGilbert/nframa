import type { Request, Response } from "express";
import { userModel } from "../models/user.model.js";
import { isAdmin } from "../middlewares/authorize.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.schema.js";

export async function createUser(req: Request, res: Response) {
  const input = req.validated.body as CreateUserInput;

  const user = await userModel.createUser(input);

  sendCreated(res, user);
}

export async function getUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const user = await userModel.findById(id);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  sendSuccess(res, user);
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateUserInput;

  // Email and phone are login identifiers, and changing one without proving you own the new one would let
  // a stolen access token become a permanent takeover (change the email, then reset the password).
  // Until there's a verified change flow, only admins can change them.
  const changesIdentifier =
    input.email !== undefined ||
    input.phoneCountryCode !== undefined ||
    input.phoneNumber !== undefined;
  if (changesIdentifier && !isAdmin(req)) {
    throw AppError.forbidden("Only an admin can change an email or phone number");
  }

  const user = await userModel.updateUser(id, input);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  sendSuccess(res, user);
}
