import { errorResponse, registry, successResponse } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRoleSchema, updateRoleSchema, roleResponseSchema } from "../schemas/role.schema.js";

const unauthorized = errorResponse("Missing or invalid access token");
const missingPermission = (action: string) => errorResponse(`Caller lacks roles: ${action}`);
const systemRole = errorResponse(
  `Caller lacks the permission, or the role is a system role (can't be edited or deleted)`,
  "Super Admin is a system role and can't be edited or deleted",
);

registry.registerPath({
  method: "get",
  path: "/roles",
  tags: ["Roles"],
  summary: "List roles with their permissions (needs roles: read)",
  description:
    "Every role, ordered by name, each with its per-module permissions and assignedAdminsCount (the admins on the role, not counting deleted accounts). Not paginated. A role's permissions only list modules where at least one action is granted, in the same shape GET /auth/me gives an admin. Needs roles: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Roles retrieved successfully", roleResponseSchema.array()),
    401: unauthorized,
    403: missingPermission("read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/roles",
  tags: ["Roles"],
  summary: "Create a role with its permissions (needs roles: create)",
  description:
    "Creates the role and its permissions together in one transaction, so a failure leaves neither behind. slug (a machine identifier such as support-admin) and name (the display name) must each be unique across roles, otherwise 409. permissions maps a module to { create, read, update, delete }: actions left out count as false, and modules left out or with every action false get no access. Omit permissions to create a role with no access yet and fill it in later with PATCH /roles/{id} or PUT /roles/{id}/permissions/{module}. An unknown module name is a 400. Roles created through the API are never system roles. The creation is recorded in the audit trail (role.create). Needs roles: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createRoleSchema } },
    },
  },
  responses: {
    201: successResponse("Role created successfully", roleResponseSchema),
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
  summary: "Get a role with its permissions (needs roles: read)",
  description:
    "One role in the same shape as a list item: its details, per-module permissions and assignedAdminsCount (deleted admin accounts are not counted). Needs roles: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: successResponse("Role retrieved successfully", roleResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: missingPermission("read"),
    404: errorResponse("Role not found", "Role not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Update a role and/or its permissions (needs roles: update)",
  description:
    "Send only the fields to change; at least one of slug, name, description and permissions is required. permissions, if sent, replaces the role's whole permission set, so modules left out lose their access; to change one module, use PUT /roles/{id}/permissions/{module}. Details and permissions are saved together. slug and name must stay unique across roles (409). System roles such as superadmin can't be edited (403), so nobody can strip the last full-access role. Changes apply to the role's admins on their next request, without them signing in again. The before and after are recorded in the audit trail (role.update). Needs roles: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
    body: {
      content: { "application/json": { schema: updateRoleSchema } },
    },
  },
  responses: {
    200: successResponse("Role updated successfully", roleResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: systemRole,
    404: errorResponse("Role not found", "Role not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
    409: errorResponse("Another role already has this slug or name"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Delete a role (needs roles: delete)",
  description:
    "Only a role with no admin accounts on it can be deleted: move them to another role first (PATCH /admin/{userId} with roleId). Deleted admin accounts still count here because their admin records keep pointing at the role, so the 409 can appear even when assignedAdminsCount is 0. System roles can't be deleted (403). The role's permissions are removed with it, and the deletion is recorded in the audit trail (role.delete). Needs roles: delete.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: successResponse("Role deleted successfully"),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: systemRole,
    404: errorResponse("Role not found", "Role not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
    409: errorResponse(
      "Admin accounts are still assigned to this role (deleted ones count too)",
      "Support Agent is still assigned to 2 admin account(s), including any deleted ones — move them to another role first",
    ),
  },
});
