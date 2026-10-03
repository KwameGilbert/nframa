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
    "A driver gets their own commutes, newest first; a rider simply gets an empty list. An admin gets every driver's commutes in one list (each has its userId) and needs commutes: read, otherwise 403. Active and paused commutes (isActive false) are both included, and there is no pagination or filter. Each commute carries its start and end addresses and coordinates, departureTime (HH:MM:SS), recurrenceDays (ISO weekdays, 1 = Monday to 7 = Sunday), capacity, isActive, and the saved route as distanceMeters and durationSeconds (null for commutes created before the route was recorded). For the riders booked on a commute and its remaining seats, use GET /commutes/{id}/trips.",
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
    "A commute is a recurring run a driver offers: a start and an end, a departure time and the weekdays it runs. The commute is for the caller unless userId is set; setting it to someone else needs commutes: create (403), so an admin must pass userId. The owner must already have a driver profile (400, create it with POST /driver). Addresses are text of 3 to 255 characters, coordinates are decimal degrees (stored to 6 decimals), departureTime is a 24-hour HH:MM with a leading zero in Ghana time (UTC+0, no daylight saving), recurrenceDays has at least one ISO weekday (1 = Monday to 7 = Sunday) with no repeats, and capacity is the number of seats offered on each run, 1 to 8. New commutes start active. The driving route between start and end is worked out when the commute is saved, with Google Directions when available and otherwise estimated from the straight-line distance, and kept as distanceMeters and durationSeconds. A commute can be created before the driver is verified, but riders only see and can book it while the driver is approved. It doesn't name a vehicle: riders see the driver's newest active vehicle. Returns the new commute and is recorded in the audit trail.",
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
  description:
    "Returns one commute, with its saved route (distanceMeters and durationSeconds, null for commutes created before the route was recorded). The driver who owns it can read it; anyone else needs commutes: read. An id that doesn't exist answers 404 to every caller, while a commute that exists but belongs to another driver answers 403. Riders read a commute's details through the trips endpoints, not here. Reading isn't recorded in the audit trail.",
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
    "Send only the fields to change, at least one (a body with none of the editable fields is a 400), under the same rules as when creating. The owner can't be changed: a userId in the body is ignored. isActive: false pauses the commute without deleting it: riders stop seeing it, and new trip requests and the acceptance of pending ones are refused with 409, while trips already accepted are left alone; true resumes it. Sending any start or end coordinate recomputes distanceMeters and durationSeconds from the merged coordinates. While the commute has trips from today on that are pending, accepted or boarded, its coordinates, departureTime and recurrenceDays can't change (409; resending the current values is fine, and overdue pending requests are expired first so they don't block): pause it with isActive: false, or cancel those trips, first. Address text, capacity and isActive can always change. Accepted trips keep their seats if the capacity is lowered below them; seats left then reads 0 until enough are freed. The driver, or an admin with commutes: update, can edit; an id that doesn't exist answers 404 to every caller, while another driver's commute answers 403. Returns the updated commute and is recorded in the audit trail with the before and after.",
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
  description:
    "Removes the commute permanently. It is only possible while the commute has never had a trip of any status, even a cancelled, declined or expired one: otherwise the database refuses and the API answers 409, and the way to take such a commute out of use is to pause it with PATCH /commutes/{id} and isActive: false. The driver, or an admin with commutes: delete, can delete; an id that doesn't exist answers 404 to every caller, while another driver's commute answers 403. Returns no data and is recorded in the audit trail with the deleted commute as it was.",
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
