import { errorResponse, registry, successResponse } from "./registry.js";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  driverProfileParamsSchema,
  driverCodeParamsSchema,
  driverPhoneParamsSchema,
  driverWithRelationsResponseSchema,
} from "../schemas/driverProfile.schema.js";
import { z } from "zod";

// Every driver-returning endpoint on this page shares one response shape — { driver: { ...profile, user,
// vehicles, documents } } — so there's a single schema (driverWithRelationsResponseSchema) below instead
// of one per endpoint. Keep it that way if you add another driver lookup.

registry.registerPath({
  method: "get",
  path: "/drivers",
  tags: ["Driver Profiles"],
  summary: "List every driver, each with their user, vehicles and documents",
  description: "Needs users: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Drivers retrieved successfully",
      z.array(driverWithRelationsResponseSchema),
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on users"),
  },
});

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
    201: successResponse("Driver profile created successfully", driverWithRelationsResponseSchema),
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
    200: successResponse(
      "Driver profile retrieved successfully",
      driverWithRelationsResponseSchema,
    ),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller isn't this driver and lacks users: read"),
    404: errorResponse("Driver profile not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/drivers/code/{code}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by driver code",
  description: "Needs users: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverCodeParamsSchema,
  },
  responses: {
    200: successResponse(
      "Driver profile retrieved successfully",
      driverWithRelationsResponseSchema,
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on users"),
    404: errorResponse("No driver with this code"),
  },
});

registry.registerPath({
  method: "get",
  path: "/drivers/phone/{phoneCountryCode}/{phoneNumber}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by phone number",
  description: "Needs users: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverPhoneParamsSchema,
  },
  responses: {
    200: successResponse(
      "Driver profile retrieved successfully",
      driverWithRelationsResponseSchema,
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on users"),
    404: errorResponse("No driver with this phone number"),
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
    200: successResponse("Driver profile updated successfully", driverWithRelationsResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller isn't this driver and lacks users: update"),
    404: errorResponse("Driver profile not found"),
  },
});
