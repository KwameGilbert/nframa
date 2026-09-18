import { registry } from "./registry.js";
import {
  createRiderProfileSchema,
  riderProfileParamsSchema,
  riderProfileResponseSchema,
} from "../schemas/riderProfile.schema.js";

registry.registerPath({
  method: "post",
  path: "/rider",
  tags: ["Rider Profiles"],
  summary: "Create a rider profile",
  request: {
    body: {
      content: { "application/json": { schema: createRiderProfileSchema } },
    },
  },
  responses: {
    201: {
      description: "Rider profile created",
      content: { "application/json": { schema: riderProfileResponseSchema } },
    },
    400: { description: "Validation error" },
    409: { description: "Rider profile already exists for this user" },
  },
});

registry.registerPath({
  method: "get",
  path: "/rider/{userId}",
  tags: ["Rider Profiles"],
  summary: "Get a rider profile by user id",
  request: {
    params: riderProfileParamsSchema,
  },
  responses: {
    200: {
      description: "The rider profile",
      content: { "application/json": { schema: riderProfileResponseSchema } },
    },
    400: { description: "Validation error" },
    404: { description: "Rider profile not found" },
  },
});
