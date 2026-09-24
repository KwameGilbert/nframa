import { errorResponse, registry } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRoleSchema, updateRoleSchema, roleResponseSchema } from "../schemas/role.schema.js";

const unauthorized = errorResponse("Missing or invalid access token");
const missingPermission = (action: string) => errorResponse(`Caller lacks roles: ${action}`);
const systemRole = errorResponse(
  `Caller lacks the permission, or the role is a system role (can't be edited or deleted)`,
);

registry.registerPath({
  method: "get",
  path: "/roles",
  tags: ["Roles"],
  summary: "List roles with their permissions",
  description:
    "Every role, its per-module permissions, and how many admins are assigned to it. Needs roles: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "All roles, sorted by name",
      content: { "application/json": { schema: roleResponseSchema.array() } },
    },
    401: unauthorized,
    403: missingPermission("read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/roles",
  tags: ["Roles"],
  summary: "Create a role with its permissions",
  description:
    "Creates the role and its permissions together. Omit permissions to create a role with no access yet. Needs roles: create.",
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
    400: errorResponse("Validation error (e.g. an unknown module)"),
    401: unauthorized,
    403: missingPermission("create"),
    409: errorResponse("A role with this slug or name already exists"),
  },
});

registry.registerPath({
  method: "get",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Get a role with its permissions",
  description: "Needs roles: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: "The role",
      content: { "application/json": { schema: roleResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: missingPermission("read"),
    404: errorResponse("Role not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Update a role and/or its permissions",
  description:
    "Send only the fields to change (at least one). permissions, if sent, replaces the role's whole permission set — to change one module, use PUT /roles/{id}/permissions/{module}. System roles can't be edited. Needs roles: update. Changes apply to assigned admins on their next request.",
  security: [{ bearerAuth: [] }],
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
    401: unauthorized,
    403: systemRole,
    404: errorResponse("Role not found"),
    409: errorResponse("Another role already has this slug or name"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Delete a role",
  description:
    "Only roles with no admins assigned can be deleted — move them to another role first (PATCH /admin/{userId} with roleId). System roles can't be deleted. Needs roles: delete.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    204: { description: "Role deleted" },
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: systemRole,
    404: errorResponse("Role not found"),
    409: errorResponse("Admins are still assigned to this role"),
  },
});
