import { errorResponse, registry, successResponse } from "./registry.js";
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
  summary: "Create a driver profile (for yourself, or anyone with users: create)",
  description:
    "userId must be the caller's own id unless the caller has users: create. The profile's code is generated, and verificationStatus starts as unverified.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createDriverProfileSchema } },
    },
  },
  responses: {
    201: successResponse("Driver profile created successfully", driverProfileResponseSchema),
    400: errorResponse("Validation error, or userId doesn't match an existing user"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller lacks users: create"),
    409: errorResponse("Driver profile already exists for this user"),
  },
});

registry.registerPath({
  method: "get",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by user id (the driver themselves, or an admin with users: read)",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverProfileParamsSchema,
  },
  responses: {
    200: successResponse("Driver profile retrieved successfully", driverProfileResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller isn't this driver and lacks users: read"),
    404: errorResponse("Driver profile not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Update a driver profile (the driver themselves, or an admin with users: update)",
  description: "Send only the fields to change (at least one).",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverProfileParamsSchema,
    body: {
      content: { "application/json": { schema: updateDriverProfileSchema } },
    },
  },
  responses: {
    200: successResponse("Driver profile updated successfully", driverProfileResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller isn't this driver and lacks users: update"),
    404: errorResponse("Driver profile not found"),
  },
});
