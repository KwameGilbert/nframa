import { errorResponse, registry, successResponse } from "./registry.js";
import { z } from "zod";
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamsSchema,
  userResponseSchema,
  userStatusHistoryResponseSchema,
} from "../schemas/user.schema.js";

registry.registerPath({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "List every rider and driver",
  description:
    "Riders and drivers only — admin accounts are listed via GET /admin instead (they're a separate permission module). Deleted accounts are excluded; look one up directly by id (GET /users/{id}) if you already have it. Needs users: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Users retrieved successfully", z.array(userResponseSchema)),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks users: read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Create a user",
  description:
    "Rider/driver signup normally happens via /auth/login/otp + /auth/login/verify, not this endpoint. This exists for admins provisioning other accounts (most commonly other admins). Needs users: create, or admin: create for an admin account. Emails are stored lowercased.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createUserSchema } },
    },
  },
  responses: {
    201: successResponse("User created successfully", userResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks users: create (admin: create for an admin account)"),
    409: errorResponse("A user with this email or phone number already exists"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Get a user by id (the user themselves, or an admin with users: read)",
  description: "Deleted users are still returned, with deletedAt set.",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: successResponse("User retrieved successfully", userResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller isn't this user and lacks users: read (admin: read for an admin account)",
    ),
    404: errorResponse("User not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Update a user (the user themselves, or an admin with users: update)",
  description:
    "Send only the fields to change (at least one). Changing email, phoneCountryCode, or phoneNumber needs users: update even on your own account — they're login identifiers. Admin accounts need admin: update instead of users: update. Emails are stored lowercased.\n\nFor a driver, personal fields (this endpoint's usual fields) and driver-specific fields can be sent together via the optional profile object (ghanaCardNumber, address, isOnline, autoAcceptBookings) — both are written in one database transaction, so a partial failure can't save one without the other. profile is rejected for non-driver accounts, and for a driver with no profile yet (create one first via POST /driver).",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
    body: {
      content: { "application/json": { schema: updateUserSchema } },
    },
  },
  responses: {
    200: successResponse("User updated successfully", userResponseSchema),
    400: errorResponse(
      "Validation error, profile sent for a non-driver account, or the driver has no profile yet",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller isn't this user and lacks users: update, or tried to change email/phone without it (admin for admin accounts)",
    ),
    404: errorResponse("User not found"),
    409: errorResponse("Another user already has this email or phone number"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}/status",
  tags: ["Users"],
  summary: "Suspend or reactivate a user",
  description:
    "Separate from PATCH /users/{id} since this is a moderation action, not a profile edit. Suspending signs the account out of every session — it can no longer log in or refresh, and any access token it holds stops working within 15 minutes. reason and notes (both optional) are recorded on a status history entry (GET /users/{id}/status-history), not on the user record itself — reason is meant to be shown to the account holder on request, notes are for staff only. Needs users: update (admin: update for an admin account); the caller can't change their own status.",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
    body: {
      content: { "application/json": { schema: updateUserStatusSchema } },
    },
  },
  responses: {
    200: successResponse("Account suspended successfully", userResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller lacks users: update (admin: update for an admin account), or tried to change their own status",
    ),
    404: errorResponse("User not found"),
    409: errorResponse("Account is already active/suspended"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}/status-history",
  tags: ["Users"],
  summary: "Get a user's status change history (suspensions and reactivations)",
  description:
    "Every status transition, newest first, each with who made it, when, and its reason/notes. Admin-only — not visible via self-access, since notes may contain internal staff commentary. Needs users: read (admin: read for an admin account).",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: successResponse(
      "Status history retrieved successfully",
      z.array(userStatusHistoryResponseSchema),
    ),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks users: read (admin: read for an admin account)"),
    404: errorResponse("User not found"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Delete a user (soft delete)",
  description:
    "Marks the account deleted (deletedAt is set; the row is kept) and signs it out of every session — it can no longer log in or refresh, and any access token it holds stops working within 15 minutes. Its email and phone number stay reserved, so they can't be used for a new account.\n\nRiders and drivers can delete their own account. Deleting anyone else needs users: delete, or admin: delete for an admin account. Admins can't delete their own account, and only an admin with a system role (superadmin) can delete another system-role admin.",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: successResponse("User deleted successfully"),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller isn't this user and lacks users: delete (admin: delete for an admin account), is an admin deleting themselves, or lacks a system role to delete a system-role admin",
    ),
    404: errorResponse("User not found"),
    409: errorResponse("User is already deleted"),
  },
});
