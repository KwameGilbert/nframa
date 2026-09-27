import { errorResponse, registry, successResponse } from "./registry.js";
import { z } from "zod";
import {
  createAdminUserSchema,
  updateAdminUserSchema,
  adminUserParamsSchema,
  adminUserWithRelationsResponseSchema,
} from "../schemas/adminUser.schema.js";

// Every admin-returning endpoint here shares one response shape — { adminUser: { ...record, user, role } }
// — via adminUserWithRelationsResponseSchema, instead of one schema per endpoint. Keep it that way if you
// add another admin lookup.

registry.registerPath({
  method: "get",
  path: "/admin",
  tags: ["Admin Users"],
  summary: "List every admin, each with their user and role (with its permissions)",
  description: "Needs admin: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Admin users retrieved successfully",
      z.array(adminUserWithRelationsResponseSchema),
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks admin: read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/admin",
  tags: ["Admin Users"],
  summary: "Create an admin user",
  description:
    "Creates the admin record for an existing admin-role user (POST /users first). The admin starts as invited and can't log in until PATCHed to active. Pass password to set their initial password; otherwise they set one via /auth/password/forgot. Needs admin: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createAdminUserSchema } },
    },
  },
  responses: {
    201: successResponse("Admin user created successfully", adminUserWithRelationsResponseSchema),
    400: errorResponse(
      "Validation error, userId isn't an existing (non-deleted) user with role admin, or roleId doesn't match a role",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks admin: create"),
    409: errorResponse("This user already has an admin record"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Get an admin user by user id",
  description: "Needs admin: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
  },
  responses: {
    200: successResponse("Admin user retrieved successfully", adminUserWithRelationsResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks admin: read"),
    404: errorResponse("Admin user not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Update an admin user, including moving them to another role",
  description:
    "Send only the fields to change (at least one). Setting status to suspended blocks new logins and refreshes; their admin permissions stop on their very next request. Admins can't change their own roleId or status (prevents locking yourself out). Needs admin: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
    body: {
      content: { "application/json": { schema: updateAdminUserSchema } },
    },
  },
  responses: {
    200: successResponse("Admin user updated successfully", adminUserWithRelationsResponseSchema),
    400: errorResponse("Validation error, or roleId doesn't match an existing role"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks admin: update, or tried to change their own role or status"),
    404: errorResponse("Admin user not found"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Delete an admin user (soft delete)",
  description:
    "Soft-deletes the admin's user account (deletedAt is set) and signs it out of every session; their admin permissions stop on their next request. The admin record is kept for history, and their email stays reserved. Their role no longer counts them in assignedAdminsCount, but the role still can't be deleted until they're moved off it.\n\nNeeds admin: delete. You can't delete your own admin account, and only an admin with a system role (superadmin) can delete another system-role admin.",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
  },
  responses: {
    200: successResponse("Admin user deleted successfully", adminUserWithRelationsResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller lacks admin: delete, is deleting themselves, or lacks a system role to delete a system-role admin",
    ),
    404: errorResponse("Admin user not found"),
    409: errorResponse("Admin user is already deleted"),
  },
});
