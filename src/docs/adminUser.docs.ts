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
  summary: "List admin users (needs admin: read)",
  description:
    "Every admin whose account has not been deleted, each as { adminUser } with the admin record (roleId, department, status), the user account and the role including its permissions. Admins whose account was deleted are left out of the list; look one up by id with GET /admin/{userId} to see it. Not paginated and not in any meaningful order, so sort and filter on the client. Needs admin: read; an admin with only users: read gets 403.",
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
  summary: "Create an admin user (needs admin: create)",
  description:
    "Second step of adding an admin: first create the account with POST /users and role admin, then call this with that userId to give it a role. userId must be an existing, non-deleted user whose role is admin and who has no admin record yet; a rider or driver is refused with 400 so nobody gets admin rights through their phone login, and a second record for the same user is a 409. roleId must be an existing role (see GET /roles), otherwise 400. The admin starts as invited and can't sign in until PATCH /admin/{userId} sets status to active; the role's permissions only count while the status is active. Pass password (8+ characters, max 72 bytes) to set their initial password; otherwise they set one via /auth/password/forgot. If the account has an email address they are sent an admin-access-granted email naming the role, and the creation is recorded in the audit trail (admin.create). Needs admin: create.",
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
  summary: "Get an admin user by user id (needs admin: read)",
  description:
    "userId is the id of the admin's user account; there is no separate admin id. Returns the admin record with the user account and the role including its permissions. Unlike the list, this also returns an admin whose account was deleted (user.deletedAt is then set). A user without an admin record, such as a rider or driver, gets 404. Viewing someone else's record is written to the audit trail (admin.view); viewing your own is not. Needs admin: read even for your own record; an admin without it can still see their own role and permissions through GET /auth/me.",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
  },
  responses: {
    200: successResponse("Admin user retrieved successfully", adminUserWithRelationsResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks admin: read"),
    404: errorResponse(
      "Admin user not found",
      "Admin user not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Update an admin user, including moving them to another role (needs admin: update)",
  description:
    "Send only the fields to change; at least one of department, status (active, suspended or invited) and roleId is required. roleId must be an existing role (400 otherwise). Permissions are read from the database on every request, so a new role or a suspension applies to the admin's very next request without them signing in again; setting status to suspended also blocks new logins and token refreshes. Admins can't change their own roleId or status (403, to prevent locking yourself out), though they can change their own department. When the role or status really changes, the admin is sent an admin-access-changed email if they have an address; sending the value they already have changes nothing and sends no email. The before and after are recorded in the audit trail (admin.update). Needs admin: update.",
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
    403: errorResponse(
      "Caller lacks admin: update, or tried to change their own role or status",
      "You can't change your own role or status",
    ),
    404: errorResponse(
      "Admin user not found",
      "Admin user not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Delete an admin user, soft delete (needs admin: delete)",
  description:
    "Soft-deletes the admin's user account (deletedAt is set) and revokes all of their refresh sessions; their admin permissions stop on their next request. The admin record is kept for history, and their email stays reserved. They are sent an account-deleted email if they have an address, and the deletion is recorded in the audit trail (admin.delete). The response is the admin as it is after the deletion, with user.deletedAt set. Their role no longer counts them in assignedAdminsCount, but the role still can't be deleted until they're moved off it.\n\nNeeds admin: delete. You can't delete your own admin account, and only an admin with a system role (superadmin) can delete another system-role admin. Deleting an account that is already deleted is a 409.",
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
      "You can't delete your own admin account",
    ),
    404: errorResponse(
      "Admin user not found",
      "Admin user not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    409: errorResponse("The account is already deleted", "User is already deleted"),
  },
});
