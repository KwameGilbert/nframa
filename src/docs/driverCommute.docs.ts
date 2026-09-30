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
    404: errorResponse(
      "Commute not found",
      "Commute not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "patch",
  path: "/commutes/{id}",
  tags: ["Driver Commutes"],
  summary: "Update a commute, or pause it with isActive: false (its driver, or commutes: update)",
  description:
    "The owner can't be changed — delete the commute and create it for the other driver. Changing any start or end coordinate recomputes distanceMeters and durationSeconds. While the commute has trips from today on that are pending, accepted or boarded, its coordinates, departureTime and recurrenceDays can't change (409; resending the current values is fine): pause it with isActive: false, or cancel those trips, first. Address text, capacity and isActive can always change. Accepted trips keep their seats if the capacity is lowered below them; seats left then reads 0 until enough are freed.",
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
    404: errorResponse(
      "Commute not found",
      "Commute not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    409: errorResponse(
      "The update changes the route, departure time or weekdays while trips from today on are pending, accepted or boarded",
      "This commute has upcoming trips: pause it or cancel them before changing its route or schedule",
    ),
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
    404: errorResponse(
      "Commute not found",
      "Commute not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    409: errorResponse(
      "The commute has trips (of any status): pause it with isActive: false instead",
      "This commute has trips: pause it instead of deleting it",
    ),
  },
});
