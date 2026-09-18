import type { Request, Response } from "express";
import { userModel } from "../models/user.model.js";
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

  const user = await userModel.updateUser(id, input);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  sendSuccess(res, user);
}
