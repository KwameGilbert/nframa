import { errorResponse, registry } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { permissionsSchema } from "../schemas/role.schema.js";
import {
  roleModuleParamsSchema,
  setModulePermissionSchema,
} from "../schemas/rolePermission.schema.js";

// Per-module management — the alternative to sending a role's whole permission set to PATCH /roles/{id}.

const unauthorized = errorResponse("Missing or invalid access token");
const systemRole = errorResponse(
  "Caller lacks roles: update, or the role is a system role (can't be edited)",
);
const updatedPermissions = {
  description: "The role's full permission set after the change",
  content: { "application/json": { schema: permissionsSchema } },
};

registry.registerPath({
  method: "get",
  path: "/roles/{id}/permissions",
  tags: ["Role Permissions"],
  summary: "Get a role's permissions",
  description: "Needs roles: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: "The role's permissions",
      content: { "application/json": { schema: permissionsSchema } },
    },
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Caller lacks roles: read"),
    404: errorResponse("Role not found"),
  },
});

registry.registerPath({
  method: "put",
  path: "/roles/{id}/permissions/{module}",
  tags: ["Role Permissions"],
  summary: "Set a role's access to one module",
  description:
    "Sets all four actions for the module; ones left out are false. All false removes the module from the role. Needs roles: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: roleModuleParamsSchema,
    body: {
      content: { "application/json": { schema: setModulePermissionSchema } },
    },
  },
  responses: {
    200: updatedPermissions,
    400: errorResponse("Validation error (e.g. an unknown module)"),
    401: unauthorized,
    403: systemRole,
    404: errorResponse("Role not found"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/roles/{id}/permissions/{module}",
  tags: ["Role Permissions"],
  summary: "Remove a role's access to one module",
  description: "Needs roles: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: roleModuleParamsSchema,
  },
  responses: {
    200: updatedPermissions,
    400: errorResponse("Validation error (e.g. an unknown module)"),
    401: unauthorized,
    403: systemRole,
    404: errorResponse("Role not found"),
  },
});
