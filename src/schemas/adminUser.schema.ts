import { z } from "zod";
import { passwordSchema } from "./common.schema.js";

const adminStatusSchema = z.enum(["active", "suspended", "invited"]).meta({
  description:
    "active: can log in and access assigned permissions; suspended: locked out; invited: awaiting first login setup. Only active admins can log in. New admins start as invited.",
  example: "active",
});

const departmentSchema = z.string().min(1).meta({ example: "Operations" });

export const createAdminUserSchema = z.object({
  userId: z
    .uuid()
    .meta({ description: "An existing user with role admin (create it via POST /users)" }),
  roleId: z.uuid(),
  department: departmentSchema.optional(),
  password: passwordSchema.optional().meta({
    description:
      "Optional initial password. Without one, the admin sets it via /auth/password/forgot. 8+ characters, max 72 bytes.",
  }),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z
  .object({
    department: departmentSchema,
    status: adminStatusSchema,
    roleId: z.uuid().meta({ description: "Move the admin to another role" }),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const adminUserParamsSchema = z.object({
  userId: z.uuid(),
});

export const adminUserResponseSchema = z.object({
  userId: z.uuid(),
  roleId: z.uuid(),
  department: z.string().nullable().meta({ example: "Operations" }),
  status: adminStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
