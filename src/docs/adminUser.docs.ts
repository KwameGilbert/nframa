import { errorResponse, registry } from "./registry.js";
import {
  createAdminUserSchema,
  updateAdminUserSchema,
  adminUserParamsSchema,
  adminUserResponseSchema,
} from "../schemas/adminUser.schema.js";

registry.registerPath({
  method: "post",
  path: "/admin",
  tags: ["Admin Users"],
  summary: "Create an admin user",
  description:
    "Creates the admin record for an existing admin-role user (POST /users first). The admin starts as invited and can't log in until PATCHed to active. Pass password to set their initial password; otherwise they set one via /auth/password/forgot. Needs roles: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createAdminUserSchema } },
    },
  },
  responses: {
    201: {
      description: "Admin user created",
      content: { "application/json": { schema: adminUserResponseSchema } },
    },
    400: errorResponse("Validation error, or userId/roleId doesn't match an existing record"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks roles: create"),
    409: errorResponse("This user already has an admin record"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Get an admin user by user id",
  description: "Needs roles: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
  },
  responses: {
    200: {
      description: "The admin user",
      content: { "application/json": { schema: adminUserResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks roles: read"),
    404: errorResponse("Admin user not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Update an admin user, including moving them to another role",
  description:
    "Send only the fields to change (at least one). Setting status to suspended blocks new logins and refreshes; their admin permissions stop on their very next request. Admins can't change their own roleId or status (prevents locking yourself out). Needs roles: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
    body: {
      content: { "application/json": { schema: updateAdminUserSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated admin user",
      content: { "application/json": { schema: adminUserResponseSchema } },
    },
    400: errorResponse("Validation error, or roleId doesn't match an existing role"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller lacks roles: update, or tried to change their own role or status"),
    404: errorResponse("Admin user not found"),
  },
});
