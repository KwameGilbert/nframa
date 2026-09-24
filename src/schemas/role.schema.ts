import { z } from "zod";
import { MODULES } from "../config/permissions.js";

export const moduleSchema = z.enum(MODULES);

// Actions left out default to false, so { "read": true } means read-only.
export const moduleActionsInputSchema = z.object({
  create: z.boolean().default(false),
  read: z.boolean().default(false),
  update: z.boolean().default(false),
  delete: z.boolean().default(false),
});

const moduleActionsSchema = z.object({
  create: z.boolean(),
  read: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
});

export const permissionsInputSchema = z.partialRecord(moduleSchema, moduleActionsInputSchema).meta({
  description:
    "Per-module access; replaces the role's whole permission set. Modules left out (or with every action false) get no access.",
  example: {
    users: { read: true, update: true },
    settings: { read: true },
  },
});

export const permissionsSchema = z.partialRecord(moduleSchema, moduleActionsSchema).meta({
  description: "Per-module access. Modules not listed have no access.",
  example: {
    users: { create: false, read: true, update: true, delete: false },
    settings: { create: false, read: true, update: false, delete: false },
  },
});

const slugSchema = z
  .string()
  .min(1)
  .meta({ description: "Unique machine-readable identifier", example: "support-admin" });
const nameSchema = z
  .string()
  .min(1)
  .meta({ description: "Unique display name", example: "Support Admin" });
const descriptionSchema = z
  .string()
  .min(1)
  .meta({ example: "Views and edits rider and driver accounts" });

export const createRoleSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema,
  permissions: permissionsInputSchema.default({}),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    slug: slugSchema,
    name: nameSchema,
    description: descriptionSchema,
    permissions: permissionsInputSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const roleResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string().meta({ example: "support-admin" }),
  name: z.string().meta({ example: "Support Admin" }),
  description: z.string().meta({ example: "Views and edits rider and driver accounts" }),
  isSystem: z
    .boolean()
    .meta({ description: "System roles (e.g. superadmin) can't be edited or deleted" }),
  permissions: permissionsSchema,
  assignedAdminsCount: z.number().int().meta({ example: 3 }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
