import type { Request, Response } from "express";
import { userModel, type User } from "../models/user.model.js";
import { assertPermission, assertSelfOrPermission } from "../middlewares/authorize.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.schema.js";

// Admin accounts are managed under "roles" (they're access control), riders/drivers under "users" — otherwise anyone with
// users access could edit an admin's email and take the account over via password reset.
function moduleFor(user: Pick<User, "role">) {
  return user.role === "admin" ? "roles" : "users";
}

async function findUserOrThrow(id: string) {
  const user = await userModel.findById(id);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  return user;
}

export async function createUser(req: Request, res: Response) {
  const input = req.validated.body as CreateUserInput;

  await assertPermission(req, moduleFor(input), "create");

  const user = await userModel.createUser(input);

  sendCreated(res, user);
}

export async function getUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const user = await findUserOrThrow(id);
  await assertSelfOrPermission(req, user.id, moduleFor(user), "read");

  sendSuccess(res, user);
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateUserInput;

  const target = await findUserOrThrow(id);
  await assertSelfOrPermission(req, target.id, moduleFor(target), "update");

  // Email and phone are login identifiers, and changing one without proving you own the new one would let
  // a stolen access token become a permanent takeover (change the email, then reset the password).
  // Until there's a verified change flow, it takes the admin permission even on your own account.
  const changesIdentifier =
    input.email !== undefined ||
    input.phoneCountryCode !== undefined ||
    input.phoneNumber !== undefined;
  if (changesIdentifier) {
    await assertPermission(req, moduleFor(target), "update");
  }

  const user = await userModel.updateUser(id, input);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  sendSuccess(res, user);
}
