import { errorResponse, registry, successResponse } from "./registry.js";
import {
  cancelSosSchema,
  listSosIncidentsQuerySchema,
  sosIncidentAdminResponseSchema,
  sosIncidentListResponseSchema,
  sosIncidentParamsSchema,
  sosIncidentResponseSchema,
  triggerSosSchema,
  updateSosStatusSchema,
} from "../schemas/sosIncident.schema.js";

const NOT_FOUND_EXAMPLE = "SOS incident not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34";

registry.registerPath({
  method: "post",
  path: "/safety/sos",
  tags: ["Safety & SOS"],
  summary: "Trigger emergency SOS alert",
  description:
    "Records an emergency alert with the caller's live GPS position and a snapshot of their emergency contacts, and alerts the safety desk in real time (socket event sos:triggered to admins with users: read). Riders and drivers only. If tripId is sent the caller must be that trip's rider or driver. A person has at most one alert in play: pressing again (or from a second phone) returns the existing alert with 200 and alerts no one twice.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: triggerSosSchema } },
    },
  },
  responses: {
    200: successResponse("An SOS alert is already active", sosIncidentResponseSchema),
    201: successResponse("Emergency SOS alert triggered successfully", sosIncidentResponseSchema),
    400: errorResponse(
      "Validation error, invalid coordinates, or a tripId that doesn't exist",
      "Trip not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "The caller is an admin, or wasn't on the trip",
      "Only riders and drivers can raise an SOS alert",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/safety/sos/active",
  tags: ["Safety & SOS"],
  summary: "Get current user's active SOS alert (if any)",
  description:
    "Returns the caller's alert that is still in play (triggered, underReview or servicesContacted), or null. Lets the app restore its status screen after a restart.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Active SOS status retrieved successfully",
      sosIncidentResponseSchema.nullable(),
    ),
    401: errorResponse("Missing or invalid access token"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/safety/sos/{id}/cancel",
  tags: ["Safety & SOS"],
  summary: "Cancel your own SOS alert (false alarm)",
  description:
    "Only the person who raised the alert can cancel it (admins use PATCH /admin/safety/incidents/{id}), and only while it is triggered or underReview: once emergency services have been contacted only operations can close it. Alerts the safety desk (sos:cancelled).",
  security: [{ bearerAuth: [] }],
  request: {
    params: sosIncidentParamsSchema,
    body: {
      content: { "application/json": { schema: cancelSosSchema } },
    },
  },
  responses: {
    200: successResponse("Emergency SOS alert cancelled successfully", sosIncidentResponseSchema),
    400: errorResponse("Invalid incident id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Not the person who raised the alert",
      "Only the person who raised the alert can cancel it",
    ),
    404: errorResponse("SOS incident not found", NOT_FOUND_EXAMPLE),
    409: errorResponse(
      "The alert is already resolved or cancelled, or emergency services have been contacted",
      "Emergency services have already been contacted, so only operations can close this alert",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/safety/incidents",
  tags: ["Safety & SOS"],
  summary: "List emergency incidents (needs users: read)",
  description:
    "The dispatch queue, newest first, filterable by status and user. Each view is recorded in the audit trail.",
  security: [{ bearerAuth: [] }],
  request: {
    query: listSosIncidentsQuerySchema,
  },
  responses: {
    200: successResponse("SOS incidents retrieved successfully", sosIncidentListResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on users"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/safety/incidents/{id}",
  tags: ["Safety & SOS"],
  summary: "Get emergency incident details (needs users: read)",
  description:
    "Includes the reporter's name and phone, their emergency contacts snapshot and operations' notes. Each view is recorded in the audit trail.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sosIncidentParamsSchema,
  },
  responses: {
    200: successResponse("SOS incident retrieved successfully", sosIncidentAdminResponseSchema),
    400: errorResponse("Invalid incident id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on users"),
    404: errorResponse("SOS incident not found", NOT_FOUND_EXAMPLE),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/safety/incidents/{id}",
  tags: ["Safety & SOS"],
  summary: "Update emergency incident status (needs users: update)",
  description:
    "Moves an alert forward: triggered, underReview, servicesContacted, resolved (a step can be skipped, never undone). A resolved or cancelled alert can't change. Resolving records who resolved it and when. Tells the person (sos:statusChanged to their user room) and the safety desk.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sosIncidentParamsSchema,
    body: {
      content: { "application/json": { schema: updateSosStatusSchema } },
    },
  },
  responses: {
    200: successResponse(
      "SOS incident status updated successfully",
      sosIncidentAdminResponseSchema,
    ),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: update on users"),
    404: errorResponse("SOS incident not found", NOT_FOUND_EXAMPLE),
    409: errorResponse(
      "The alert is already resolved or cancelled, or the status would move backwards",
      "Can't move an SOS alert from resolved to underReview",
    ),
  },
});
