import { registry } from "./registry.js";
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
  summary: "Create an admin user (admin only)",
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
    400: { description: "Validation error" },
    401: { description: "Missing or invalid access token" },
    403: { description: "Caller is not an admin" },
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Get an admin user by user id (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    params: adminUserParamsSchema,
  },
  responses: {
    200: {
      description: "The admin user",
      content: { "application/json": { schema: adminUserResponseSchema } },
    },
    400: { description: "Validation error" },
    401: { description: "Missing or invalid access token" },
    403: { description: "Caller is not an admin" },
    404: { description: "Admin user not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Update an admin user (admin only)",
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
    400: { description: "Validation error" },
    401: { description: "Missing or invalid access token" },
    403: { description: "Caller is not an admin" },
    404: { description: "Admin user not found" },
  },
});
