import { errorResponse, registry, successResponse } from "./registry.js";
import { z } from "zod";
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamsSchema,
  userResponseSchema,
  userStatusHistoryResponseSchema,
  userWithStatusHistoryResponseSchema,
} from "../schemas/user.schema.js";
import {
  activityLogListResponseSchema,
  userActivityLogsQuerySchema,
} from "../schemas/activityLog.schema.js";

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
  description:
    "Deleted users are still returned, with deletedAt set. Includes statusHistory (every suspend/reactivate transition, newest first) — when the caller is the account holder themselves, each entry's notes is null (staff-only); an admin viewing someone else's account sees it as recorded.",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: successResponse("User retrieved successfully", userWithStatusHistoryResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller isn't this user and lacks users: read (admin: read for an admin account)",
    ),
    404: errorResponse("User not found", "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Update a user (the user themselves, or an admin with users: update)",
  description:
    "Send only the fields to change (at least one). Changing email, phoneCountryCode, or phoneNumber needs users: update even on your own account — they're login identifiers. Admin accounts need admin: update instead of users: update. Emails are stored lowercased.\n\nprofilePicture can be provided as: (1) a URL string (e.g., https://example.com/image.jpg), (2) a file upload via multipart/form-data with field name 'profilePicture', or (3) a base64-encoded image in JSON (e.g., { profilePicture: \"data:image/png;base64,...\" } or { profilePicture: \"raw-base64-string\" } — defaults to JPEG if no MIME type). Files are uploaded to cloud storage and the returned URL is stored.\n\nFor a driver, personal fields (this endpoint's usual fields) and driver-specific fields can be sent together via the optional profile object (ghanaCardNumber, address, isOnline, autoAcceptBookings) — both are written in one database transaction, so a partial failure can't save one without the other. profile is rejected for non-driver accounts, and for a driver with no profile yet (create one first via POST /driver).",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
    body: {
      content: {
        "application/json": { schema: updateUserSchema },
        "multipart/form-data": { schema: updateUserSchema },
      },
    },
  },
  responses: {
    200: successResponse("User updated successfully", userResponseSchema),
    400: errorResponse(
      "Validation error, invalid base64 encoding, unsupported file type (JPEG, PNG, WEBP, PDF only), file too large (>10MB), profile sent for a non-driver account, or the driver has no profile yet",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller isn't this user and lacks users: update, or tried to change email/phone without it (admin for admin accounts)",
    ),
    404: errorResponse("User not found", "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
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
      "You can't change your own account status",
    ),
    404: errorResponse("User not found", "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
    409: errorResponse("Account is already active/suspended", "Account is already suspended"),
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
    404: errorResponse("User not found", "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}/activity-logs",
  tags: ["Users"],
  summary: "Get one account's activity: what it did, and what was done to it",
  description:
    "Both directions of the audit trail for this account — entries where it's the actor (sign-ins, uploads, changes it made) and entries where it's the target (profile changes, suspensions, etc. done to it by someone else). Newest first. This is the same entry shape as GET /admin/activity-logs, so it needs the same permission — activityLogs: read, not users: read — rather than exposing audit detail (IP, request body) to anyone who can merely view profiles. For a narrower view (target only, or actor only), use GET /admin/activity-logs directly with targetType=user&targetId={id} or actorId={id}.",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
    query: userActivityLogsQuerySchema,
  },
  responses: {
    200: successResponse(
      "User activity logs retrieved successfully",
      activityLogListResponseSchema,
    ),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Missing permission: read on activityLogs",
      "Missing permission: read on activityLogs",
    ),
    404: errorResponse("User not found", "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Delete a user (soft delete)",
  description:
    "Marks the account deleted (deletedAt is set; the row is kept) and signs it out of every session — it can no longer log in or refresh, and any access token it holds stops working within 15 minutes. Its email and phone number stay reserved, so they can't be used for a different account — but a deleted rider or driver can sign up again with the same phone number, which reactivates this account with a clean profile (see POST /auth/login/otp).\n\nRiders and drivers can delete their own account. Deleting anyone else needs users: delete, or admin: delete for an admin account. Admins can't delete their own account, and only an admin with a system role (superadmin) can delete another system-role admin.",
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
      "You can't delete your own admin account",
    ),
    404: errorResponse("User not found", "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
    409: errorResponse("User is already deleted", "User is already deleted"),
  },
});
