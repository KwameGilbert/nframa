import { errorResponse, registry } from "./registry.js";
import {
  createRiderProfileSchema,
  riderProfileParamsSchema,
  riderProfileResponseSchema,
} from "../schemas/riderProfile.schema.js";

registry.registerPath({
  method: "post",
  path: "/rider",
  tags: ["Rider Profiles"],
  summary: "Create a rider profile (for yourself, or any user as an admin)",
  description: "userId must be the caller's own id unless the caller is an admin.",
  security: [{ bearerAuth: [] }],
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
    400: errorResponse("Validation error, or userId doesn't match an existing user"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller isn't an admin"),
    409: errorResponse("Rider profile already exists for this user"),
  },
});

registry.registerPath({
  method: "get",
  path: "/rider/{userId}",
  tags: ["Rider Profiles"],
  summary: "Get a rider profile by user id (the rider themselves, or an admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: riderProfileParamsSchema,
  },
  responses: {
    200: {
      description: "The rider profile",
      content: { "application/json": { schema: riderProfileResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is neither this rider nor an admin"),
    404: errorResponse("Rider profile not found"),
  },
});
