import { z } from "zod";
import { errorResponse, registry, successResponse } from "./registry.js";
import {
  createDriverCommuteSchema,
  driverCommuteParamsSchema,
  driverCommuteResponseSchema,
  updateDriverCommuteSchema,
} from "../schemas/driverCommute.schema.js";

registry.registerPath({
  method: "get",
  path: "/commutes",
  tags: ["Driver Commutes"],
  summary: "List commutes (your own, or every driver's for an admin with commutes: read)",
  description:
    "Drivers get only their own commutes, newest first. Admins get every driver's and need commutes: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Commutes retrieved successfully", z.array(driverCommuteResponseSchema)),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is an admin without commutes: read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/commutes",
  tags: ["Driver Commutes"],
  summary: "Create a commute (for yourself, or anyone with commutes: create)",
  description:
    "The commute is for the caller unless userId is set; setting it to someone else needs commutes: create. The owner must already have a driver profile. New commutes start active. The route (distanceMeters, durationSeconds) between start and end is computed and saved on the commute.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createDriverCommuteSchema } },
    },
  },
  responses: {
    201: successResponse("Commute created successfully", driverCommuteResponseSchema),
    400: errorResponse("Validation error, or the owner has no driver profile"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller lacks commutes: create"),
  },
});

registry.registerPath({
  method: "get",
  path: "/commutes/{id}",
  tags: ["Driver Commutes"],
  summary: "Get a commute (its driver, or an admin with commutes: read)",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverCommuteParamsSchema,
  },
  responses: {
    200: successResponse("Commute retrieved successfully", driverCommuteResponseSchema),
    400: errorResponse("Invalid commute id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Not the commute's driver and lacking commutes: read"),
    404: errorResponse("Commute not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/commutes/{id}",
  tags: ["Driver Commutes"],
  summary: "Update a commute, or pause it with isActive: false (its driver, or commutes: update)",
  description:
    "The owner can't be changed — delete the commute and create it for the other driver. Changing any start or end coordinate recomputes distanceMeters and durationSeconds.",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverCommuteParamsSchema,
    body: {
      content: { "application/json": { schema: updateDriverCommuteSchema } },
    },
  },
  responses: {
    200: successResponse("Commute updated successfully", driverCommuteResponseSchema),
    400: errorResponse("Validation error, or no fields provided"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Not the commute's driver and lacking commutes: update"),
    404: errorResponse("Commute not found"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/commutes/{id}",
  tags: ["Driver Commutes"],
  summary: "Delete a commute (its driver, or an admin with commutes: delete)",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverCommuteParamsSchema,
  },
  responses: {
    200: successResponse("Commute deleted successfully"),
    400: errorResponse("Invalid commute id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Not the commute's driver and lacking commutes: delete"),
    404: errorResponse("Commute not found"),
  },
});
