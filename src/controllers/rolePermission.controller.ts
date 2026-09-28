import type { Request, Response } from "express";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { assertNotSystemRole, findRoleOrThrow } from "./role.controller.js";
import { logActivity } from "../services/activityLog.service.js";
import { sendSuccess } from "../utils/response.js";
import type {
  RoleModuleParams,
  SetModulePermissionInput,
} from "../schemas/rolePermission.schema.js";

// Per-module management of a role's permissions. Each handler returns the role's full permission map
// after the change, so the client doesn't need a second request to refresh.

const PERMISSION_ACTIVITY = { module: "roles", targetType: "role" } as const;

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

  const role = await findRoleOrThrow(id);
  assertNotSystemRole(role);
  await rolePermissionModel.setModule(id, module, actions);
  const permissions = await rolePermissionModel.findByRole(id);

  sendSuccess(res, "Role permission updated successfully", permissions);

  logActivity(req, {
    ...PERMISSION_ACTIVITY,
    action: "role.permission.set",
    description: `Set a role's ${module} permissions`,
    targetId: id,
    before: role.permissions,
    after: permissions,
  });
}

export async function removeRoleModulePermission(req: Request, res: Response) {
  const { id, module } = req.validated.params as RoleModuleParams;

  const role = await findRoleOrThrow(id);
  assertNotSystemRole(role);
  await rolePermissionModel.removeModule(id, module);
  const permissions = await rolePermissionModel.findByRole(id);

  sendSuccess(res, "Role permission removed successfully", permissions);

  logActivity(req, {
    ...PERMISSION_ACTIVITY,
    action: "role.permission.remove",
    description: `Removed a role's access to ${module}`,
    targetId: id,
    before: role.permissions,
    after: permissions,
  });
}
