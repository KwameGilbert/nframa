import { z } from "zod";

const permissionValue = z.record(z.string(), z.unknown()).meta({
  description: "Free-form JSON object describing what the role can do",
  example: { finance: { create: false, read: true, update: true, delete: false } },
});

export const createRolePermissionSchema = z.object({
  roleId: z.uuid(),
  permission: permissionValue,
});

export type CreateRolePermissionInput = z.infer<typeof createRolePermissionSchema>;

export const updateRolePermissionSchema = z.object({
  permission: permissionValue,
});

export type UpdateRolePermissionInput = z.infer<typeof updateRolePermissionSchema>;

export const roleIdParamsSchema = z.object({
  roleId: z.uuid(),
});

export const rolePermissionResponseSchema = z.object({
  id: z.uuid(),
  roleId: z.uuid(),
  permission: permissionValue,
});
