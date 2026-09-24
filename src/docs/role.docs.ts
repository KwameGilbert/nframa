import { errorResponse, registry } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRoleSchema, updateRoleSchema, roleResponseSchema } from "../schemas/role.schema.js";

registry.registerPath({
  method: "post",
  path: "/roles",
  tags: ["Roles"],
  summary: "Create a role (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createRoleSchema } },
    },
  },
  responses: {
    201: {
      description: "Role created",
      content: { "application/json": { schema: roleResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is not an admin"),
    409: errorResponse("A role with this slug or name already exists"),
  },
});

registry.registerPath({
  method: "get",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Get a role by id",
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: "The role",
      content: { "application/json": { schema: roleResponseSchema } },
    },
    400: errorResponse("Validation error"),
    404: errorResponse("Role not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Update a role",
  description: "Send only the fields to change (at least one).",
  request: {
    params: idParamsSchema,
    body: {
      content: { "application/json": { schema: updateRoleSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated role",
      content: { "application/json": { schema: roleResponseSchema } },
    },
    400: errorResponse("Validation error"),
    404: errorResponse("Role not found"),
    409: errorResponse("Another role already has this slug or name"),
  },
});
