import { errorResponse, registry } from "./registry.js";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  driverProfileParamsSchema,
  driverProfileResponseSchema,
} from "../schemas/driverProfile.schema.js";

registry.registerPath({
  method: "post",
  path: "/driver",
  tags: ["Driver Profiles"],
  summary: "Create a driver profile (for yourself, or any user as an admin)",
  description:
    "userId must be the caller's own id unless the caller is an admin. The profile's code is generated, and verificationStatus starts as unverified.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createDriverProfileSchema } },
    },
  },
  responses: {
    201: {
      description: "Driver profile created",
      content: { "application/json": { schema: driverProfileResponseSchema } },
    },
    400: errorResponse("Validation error, or userId doesn't match an existing user"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller isn't an admin"),
    409: errorResponse("Driver profile already exists for this user"),
  },
});

registry.registerPath({
  method: "get",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by user id (the driver themselves, or an admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverProfileParamsSchema,
  },
  responses: {
    200: {
      description: "The driver profile",
      content: { "application/json": { schema: driverProfileResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is neither this driver nor an admin"),
    404: errorResponse("Driver profile not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Update a driver profile (the driver themselves, or an admin)",
  description: "Send only the fields to change (at least one).",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverProfileParamsSchema,
    body: {
      content: { "application/json": { schema: updateDriverProfileSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated driver profile",
      content: { "application/json": { schema: driverProfileResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is neither this driver nor an admin"),
    404: errorResponse("Driver profile not found"),
  },
});
