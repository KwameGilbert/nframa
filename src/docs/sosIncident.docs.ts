import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  adminCancelSosSchema,
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
    "The panic button. Records an alert with the caller's GPS position and a snapshot of their emergency contacts as they are right now (a later edit to the contacts doesn't change who was meant to be told), then alerts the safety desk in real time (socket event sos:triggered to every admin with sos: read) and emails the person a confirmation if their account has an email address. Riders and drivers only. If tripId is sent the caller must be that trip's rider or driver, and the alert is linked to the trip. A person has at most one alert in play (triggered, underReview or servicesContacted): pressing again, or pressing from a second phone, returns the existing alert with 200 and alerts no one twice, even when the presses arrive at the same moment. Once the alert is closed, a new one can be raised. Rate limited per account (60 per 15 minutes) as a flood guard only; it is never meant to refuse someone in danger.",
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
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/safety/sos/active",
  tags: ["Safety & SOS"],
  summary: "Get current user's active SOS alert (if any)",
  description:
    "Returns the caller's alert that is still in play (triggered, underReview or servicesContacted), or null when there is none or theirs has been closed. Lets the app restore its status screen after a restart or on a new device, then follow along with the sos:statusChanged socket event. Operations' internal notes and which admin handled the alert are never included.",
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
    "For an alert pressed by accident. Only the person who raised the alert can use this (staff use POST /admin/safety/incidents/{id}/cancel), and only while it is triggered or underReview: once emergency services have been contacted only operations can close it, so a person can't call off help that is already on its way. The optional cancellationReason is kept for staff and never shown back to the person. Alerts the safety desk (socket event sos:cancelled). If a dispatcher moves the alert at the same moment, exactly one of the two wins and the other gets 409. Rate limited per account (60 per 15 minutes).",
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
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/safety/incidents",
  tags: ["Safety & SOS"],
  summary: "List emergency incidents (needs sos: read)",
  description:
    "The dispatch queue: every SOS alert, newest first, paginated. Filter by status (for example triggered to see what nobody has looked at yet) and by the person's user id. Each item carries the person's name and phone, the position, the trip it was raised on and, once staff have acted, who and when. Opening the list is recorded in the audit trail. For live updates listen for the sos:triggered, sos:cancelled and sos:statusChanged socket events.",
  security: [{ bearerAuth: [] }],
  request: {
    query: listSosIncidentsQuerySchema,
  },
  responses: {
    200: successResponse("SOS incidents retrieved successfully", sosIncidentListResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on sos"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/safety/incidents/{id}",
  tags: ["Safety & SOS"],
  summary: "Get emergency incident details (needs sos: read)",
  description:
    "Everything staff need to act on one alert: the reporter's name and phone, the position and address, the trip it was raised on, the snapshot of their emergency contacts to call, operations' notes and, when the alert is closed, who closed it and when. Each view is recorded in the audit trail, because the record holds a person's phone number and location.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sosIncidentParamsSchema,
  },
  responses: {
    200: successResponse("SOS incident retrieved successfully", sosIncidentAdminResponseSchema),
    400: errorResponse("Invalid incident id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on sos"),
    404: errorResponse("SOS incident not found", NOT_FOUND_EXAMPLE),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/safety/incidents/{id}",
  tags: ["Safety & SOS"],
  summary: "Update emergency incident status (needs sos: update)",
  description:
    "Moves an alert forward through underReview, servicesContacted and resolved. A step can be skipped, never undone, and a resolved or cancelled alert can't change any more. resolutionNotes are optional and staff-only; resolving records which admin resolved it and when. Tells the person (socket event sos:statusChanged to their user room, and an email if their account has one) and the rest of the safety desk. Use POST /admin/safety/incidents/{id}/cancel to call an alert off instead. If two dispatchers act at the same moment, exactly one wins and the other gets 409.",
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
    403: errorResponse("Missing permission: update on sos"),
    404: errorResponse("SOS incident not found", NOT_FOUND_EXAMPLE),
    409: errorResponse(
      "The alert is already resolved or cancelled, or the status would move backwards",
      "Can't move an SOS alert from resolved to underReview",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/safety/incidents/{id}/cancel",
  tags: ["Safety & SOS"],
  summary: "Cancel an emergency incident as staff (needs sos: update)",
  description:
    "For an alert that should not be acted on: a false alarm, a duplicate, a test. Unlike the person's own cancel it works from any status that is still in play (triggered, underReview or servicesContacted), including after emergency services were contacted. The alert becomes cancelledByAdmin, a final status, and records which admin cancelled it and when. The optional resolutionNotes say why; they are staff-only and replace earlier notes only when given. Tells the person (socket event sos:statusChanged to their user room, and an email if their account has one) and drops the alert from the rest of the safety desk's queue (sos:cancelled). The person can raise a new alert afterwards. An alert that is already resolved or cancelled answers 409, and if the person cancels or a dispatcher resolves at the same moment exactly one of the two wins.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sosIncidentParamsSchema,
    body: {
      content: { "application/json": { schema: adminCancelSosSchema } },
    },
  },
  responses: {
    200: successResponse("SOS incident cancelled successfully", sosIncidentAdminResponseSchema),
    400: errorResponse("Invalid incident id, or notes longer than 2000 characters"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: update on sos"),
    404: errorResponse("SOS incident not found", NOT_FOUND_EXAMPLE),
    409: errorResponse(
      "The alert is already resolved or cancelled",
      "Can't cancel an SOS alert that is resolved",
    ),
  },
});
