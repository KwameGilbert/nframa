import { errorResponse, registry } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createRolePermissionSchema,
  updateRolePermissionSchema,
  roleIdParamsSchema,
  rolePermissionResponseSchema,
} from "../schemas/rolePermission.schema.js";

registry.registerPath({
  method: "post",
  path: "/role-permissions",
  tags: ["Role Permissions"],
  summary: "Grant a permission to a role (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createRolePermissionSchema } },
    },
  },
  responses: {
    201: {
      description: "Role permission created",
      content: { "application/json": { schema: rolePermissionResponseSchema } },
    },
    400: errorResponse("Validation error, or roleId doesn't match an existing role"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is not an admin"),
  },
});

registry.registerPath({
  method: "get",
  path: "/role-permissions/{id}",
  tags: ["Role Permissions"],
  summary: "Get a role permission by id",
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: "The role permission",
      content: { "application/json": { schema: rolePermissionResponseSchema } },
    },
    400: errorResponse("Validation error"),
    404: errorResponse("Role permission not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/role-permissions/{id}",
  tags: ["Role Permissions"],
  summary: "Update a role permission",
  description: "Replaces the whole permission object.",
  request: {
    params: idParamsSchema,
    body: {
      content: { "application/json": { schema: updateRolePermissionSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated role permission",
      content: { "application/json": { schema: rolePermissionResponseSchema } },
    },
    400: errorResponse("Validation error"),
    404: errorResponse("Role permission not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/roles/{roleId}/permissions",
  tags: ["Role Permissions"],
  summary: "List all permissions granted to a role",
  description: "Returns an empty array if the role has no permissions or doesn't exist.",
  request: {
    params: roleIdParamsSchema,
  },
  responses: {
    200: {
      description: "The role's permissions",
      content: {
        "application/json": { schema: rolePermissionResponseSchema.array() },
      },
    },
    400: errorResponse("Validation error"),
  },
});
