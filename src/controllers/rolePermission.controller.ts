import type { Request, Response } from "express";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateRolePermissionInput,
  UpdateRolePermissionInput,
} from "../schemas/rolePermission.schema.js";

export async function createRolePermission(req: Request, res: Response) {
  const input = req.validated.body as CreateRolePermissionInput;

  const rolePermission = await rolePermissionModel.createRolePermission(input);

  sendCreated(res, rolePermission);
}

export async function getRolePermission(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const rolePermission = await rolePermissionModel.findById(id);

  if (!rolePermission) {
    throw AppError.notFound(`Role permission not found: ${id}`);
  }

  sendSuccess(res, rolePermission);
}

export async function updateRolePermission(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateRolePermissionInput;

  const rolePermission = await rolePermissionModel.updateRolePermission(id, input);

  if (!rolePermission) {
    throw AppError.notFound(`Role permission not found: ${id}`);
  }

  sendSuccess(res, rolePermission);
}

export async function listRolePermissions(req: Request, res: Response) {
  const { roleId } = req.validated.params as { roleId: string };

  const rolePermissions = await rolePermissionModel.findByRoleId(roleId);

  sendSuccess(res, rolePermissions);
}
