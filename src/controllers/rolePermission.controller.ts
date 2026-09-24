import type { Request, Response } from "express";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { assertNotSystemRole, findRoleOrThrow } from "./role.controller.js";
import { sendSuccess } from "../utils/response.js";
import type {
  RoleModuleParams,
  SetModulePermissionInput,
} from "../schemas/rolePermission.schema.js";

// Per-module management of a role's permissions. Each handler returns the role's full permission map
// after the change, so the client doesn't need a second request to refresh.

export async function getRolePermissions(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  await findRoleOrThrow(id);

  sendSuccess(
    res,
    "Role permissions retrieved successfully",
    await rolePermissionModel.findByRole(id),
  );
}

export async function setRoleModulePermission(req: Request, res: Response) {
  const { id, module } = req.validated.params as RoleModuleParams;
  const actions = req.validated.body as SetModulePermissionInput;

  assertNotSystemRole(await findRoleOrThrow(id));
  await rolePermissionModel.setModule(id, module, actions);

  sendSuccess(
    res,
    "Role permission updated successfully",
    await rolePermissionModel.findByRole(id),
  );
}

export async function removeRoleModulePermission(req: Request, res: Response) {
  const { id, module } = req.validated.params as RoleModuleParams;

  assertNotSystemRole(await findRoleOrThrow(id));
  await rolePermissionModel.removeModule(id, module);

  sendSuccess(
    res,
    "Role permission removed successfully",
    await rolePermissionModel.findByRole(id),
  );
}
