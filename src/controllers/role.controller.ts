import type { Request, Response } from "express";
import { roleModel, type Role } from "../models/role.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema.js";

export async function findRoleOrThrow(id: string): Promise<Role> {
  const role = await roleModel.findById(id);

  if (!role) {
    throw AppError.notFound(`Role not found: ${id}`);
  }

  return role;
}

// System roles (super-admin) are fixed so nobody can strip the last full-access role and lock everyone out.
export function assertNotSystemRole(role: Role) {
  if (role.isSystem) {
    throw AppError.forbidden(`${role.name} is a system role and can't be edited or deleted`);
  }
}

export async function listRoles(_req: Request, res: Response) {
  sendSuccess(res, "Roles retrieved successfully", await roleModel.listWithPermissions());
}

export async function getRole(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const role = await roleModel.findWithPermissions(id);

  if (!role) {
    throw AppError.notFound(`Role not found: ${id}`);
  }

  sendSuccess(res, "Role retrieved successfully", role);
}

export async function createRole(req: Request, res: Response) {
  const input = req.validated.body as CreateRoleInput;

  const role = await roleModel.createWithPermissions(input);

  sendCreated(res, "Role created successfully", role);
}

export async function updateRole(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateRoleInput;

  assertNotSystemRole(await findRoleOrThrow(id));

  const role = await roleModel.updateWithPermissions(id, input);

  sendSuccess(res, "Role updated successfully", role);
}

export async function deleteRole(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const role = await findRoleOrThrow(id);
  assertNotSystemRole(role);

  // Deleted admins count here: their admin records still reference the role, so the database would refuse.
  const assigned =
    (await roleModel.countAssignedAdmins([id], { includeDeleted: true })).get(id) ?? 0;
  if (assigned > 0) {
    throw AppError.conflict(
      `${role.name} is still assigned to ${assigned} admin account(s), including any deleted ones — move them to another role first`,
    );
  }

  await roleModel.deleteById(id);

  sendSuccess(res, "Role deleted successfully");
}
