import { z } from "zod";
import { passwordSchema } from "./common.schema.js";
import { userResponseSchema } from "./user.schema.js";
import { roleResponseSchema } from "./role.schema.js";

const adminStatusSchema = z.enum(["active", "suspended", "invited"]).meta({
  description:
    "active: can log in and uses the role's permissions; suspended: locked out, no permissions and no new logins or refreshes; invited: set up but not yet switched on, can't log in. Only active admins can log in, and only an active admin's role permissions apply. New admins start as invited; PATCH /admin/{userId} changes the status (an admin can't change their own).",
  example: "active",
});

const departmentSchema = z.string().min(1).meta({
  description:
    "Free-text team or department name, shown with the admin. Has no effect on permissions.",
  example: "Operations",
});

export const createAdminUserSchema = z.object({
  userId: z.uuid().meta({
    description:
      "Id of an existing, non-deleted user whose role is admin and who has no admin record yet (create the account with POST /users first)",
  }),
  roleId: z.uuid().meta({
    description:
      "The role to give the admin; its permissions apply once the admin is active. Must be an existing role (see GET /roles)",
  }),
  department: departmentSchema.optional(),
  password: passwordSchema.optional().meta({
    description:
      "Optional initial password for the admin's account. Without one, the admin sets it via /auth/password/forgot (the account needs an email address for that). 8+ characters, max 72 bytes. Never returned in a response.",
  }),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z
  .object({
    department: departmentSchema,
    status: adminStatusSchema,
    roleId: z.uuid().meta({
      description:
        "Move the admin to another role (must exist, see GET /roles). Applies on their next request. Admins can't change their own roleId",
    }),
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

// Every admin-returning endpoint (create, list, get, update, delete) responds with this same shape — the
// admin record plus its user and role (role carries that role's permissions). See adminUserModel.findByIdWithRelations.
export const adminUserWithRelationsResponseSchema = z.object({
  adminUser: adminUserResponseSchema.extend({
    user: userResponseSchema,
    role: roleResponseSchema.nullable(),
  }),
});
