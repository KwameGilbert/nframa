import { registry } from "./registry.js";
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
  summary: "Create a user",
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
    400: { description: "Validation error" },
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Get a user by id",
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: {
      description: "The user",
      content: { "application/json": { schema: userResponseSchema } },
    },
    400: { description: "Validation error" },
    404: { description: "User not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Update a user",
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
    400: { description: "Validation error" },
    404: { description: "User not found" },
  },
});
