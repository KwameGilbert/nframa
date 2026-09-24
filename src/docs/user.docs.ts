import { errorResponse, registry } from "./registry.js";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamsSchema,
  userResponseSchema,
} from "../schemas/user.schema.js";

registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Create a user (admin only)",
  description:
    "Rider/driver signup normally happens via /auth/login/otp + /auth/login/verify, not this endpoint. This exists for admins provisioning other accounts (most commonly other admins). Emails are stored lowercased.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createUserSchema } },
    },
  },
  responses: {
    201: {
      description: "User created",
      content: { "application/json": { schema: userResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is not an admin"),
    409: errorResponse("A user with this email or phone number already exists"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Get a user by id (the user themselves, or an admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: {
      description: "The user",
      content: { "application/json": { schema: userResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is neither this user nor an admin"),
    404: errorResponse("User not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Update a user (the user themselves, or an admin)",
  description:
    "Send only the fields to change (at least one). Only admins can change email, phoneCountryCode, or phoneNumber — they're login identifiers. Emails are stored lowercased.",
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParamsSchema,
    body: {
      content: { "application/json": { schema: updateUserSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated user",
      content: { "application/json": { schema: userResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Caller is neither this user nor an admin, or a non-admin tried to change email/phone",
    ),
    404: errorResponse("User not found"),
    409: errorResponse("Another user already has this email or phone number"),
  },
});
