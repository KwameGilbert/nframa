import { z } from "zod";
import { passwordSchema } from "./common.schema.js";

export const createAdminUserSchema = z.object({
  userId: z.uuid(),
  roleId: z.uuid(),
  department: z.string().min(1).optional(),
  password: passwordSchema.optional(),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z
  .object({
    department: z.string().min(1),
    status: z.enum(["active", "suspended", "invited"]),
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
  department: z.string().nullable(),
  status: z.enum(["active", "suspended", "invited"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
