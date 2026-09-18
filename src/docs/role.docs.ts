import { registry } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRoleSchema, updateRoleSchema, roleResponseSchema } from "../schemas/role.schema.js";

registry.registerPath({
  method: "post",
  path: "/roles",
  tags: ["Roles"],
  summary: "Create a role",
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
    400: { description: "Validation error" },
    409: { description: "A role with this slug or name already exists" },
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
    400: { description: "Validation error" },
    404: { description: "Role not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Update a role",
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
    400: { description: "Validation error" },
    404: { description: "Role not found" },
  },
});
