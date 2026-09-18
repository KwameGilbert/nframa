import type { Request, Response } from "express";
import { roleModel } from "../models/role.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema.js";

export async function createRole(req: Request, res: Response) {
  const input = req.validated.body as CreateRoleInput;

  const role = await roleModel.createRole(input);

  sendCreated(res, role);
}

export async function getRole(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const role = await roleModel.findById(id);

  if (!role) {
    throw AppError.notFound(`Role not found: ${id}`);
  }

  sendSuccess(res, role);
}

export async function updateRole(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateRoleInput;

  const role = await roleModel.updateRole(id, input);

  if (!role) {
    throw AppError.notFound(`Role not found: ${id}`);
  }

  sendSuccess(res, role);
}
