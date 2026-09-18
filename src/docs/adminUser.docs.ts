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
  summary: "Create an admin user",
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
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Get an admin user by user id",
  request: {
    params: adminUserParamsSchema,
  },
  responses: {
    200: {
      description: "The admin user",
      content: { "application/json": { schema: adminUserResponseSchema } },
    },
    400: { description: "Validation error" },
    404: { description: "Admin user not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/{userId}",
  tags: ["Admin Users"],
  summary: "Update an admin user",
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
    404: { description: "Admin user not found" },
  },
});
