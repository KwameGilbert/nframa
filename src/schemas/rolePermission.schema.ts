import { z } from "zod";
import { moduleActionsInputSchema, moduleSchema } from "./role.schema.js";

// Per-module management of a role's permissions — the alternative to sending the whole set to PATCH /roles/:id.

export const roleModuleParamsSchema = z.object({
  id: z.uuid(),
  module: moduleSchema,
});

export type RoleModuleParams = z.infer<typeof roleModuleParamsSchema>;

export const setModulePermissionSchema = moduleActionsInputSchema.meta({
  description: "Actions left out default to false. All false removes the module from the role.",
  example: { create: false, read: true, update: true, delete: false },
});

export type SetModulePermissionInput = z.infer<typeof setModulePermissionSchema>;
