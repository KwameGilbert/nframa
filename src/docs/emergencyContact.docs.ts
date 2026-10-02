import { z } from "zod";
import { errorResponse, registry, successResponse } from "./registry.js";
import {
  createEmergencyContactSchema,
  emergencyContactParamsSchema,
  emergencyContactResponseSchema,
  listEmergencyContactsQuerySchema,
  updateEmergencyContactSchema,
} from "../schemas/emergencyContact.schema.js";

const NOT_FOUND_EXAMPLE = "Emergency contact not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34";

registry.registerPath({
  method: "get",
  path: "/emergency-contacts",
  tags: ["Emergency Contacts"],
  summary: "List emergency contacts (your own, or another user's with users: read)",
  description:
    "Returns the caller's contacts, oldest first. Pass userId to list someone else's, which needs users: read.",
  security: [{ bearerAuth: [] }],
  request: { query: listEmergencyContactsQuerySchema },
  responses: {
    200: successResponse(
      "Emergency contacts retrieved successfully",
      z.array(emergencyContactResponseSchema),
    ),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller lacks users: read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/emergency-contacts",
  tags: ["Emergency Contacts"],
  summary: "Add an emergency contact (for yourself, or anyone with users: create)",
  description:
    "The contact is for the caller unless userId is set; setting it to someone else needs users: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createEmergencyContactSchema } },
    },
  },
  responses: {
    201: successResponse("Emergency contact created successfully", emergencyContactResponseSchema),
    400: errorResponse("Validation error, or userId doesn't match an existing user"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("userId isn't the caller and the caller lacks users: create"),
  },
});

registry.registerPath({
  method: "get",
  path: "/emergency-contacts/{id}",
  tags: ["Emergency Contacts"],
  summary: "Get an emergency contact (its owner, or an admin with users: read)",
  security: [{ bearerAuth: [] }],
  request: { params: emergencyContactParamsSchema },
  responses: {
    200: successResponse("Emergency contact retrieved successfully", emergencyContactResponseSchema),
    400: errorResponse("Invalid emergency contact id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Not the contact's owner and lacking users: read"),
    404: errorResponse("Emergency contact not found", NOT_FOUND_EXAMPLE),
  },
});

registry.registerPath({
  method: "patch",
  path: "/emergency-contacts/{id}",
  tags: ["Emergency Contacts"],
  summary: "Update an emergency contact (its owner, or an admin with users: update)",
  description: "The owner can't be changed — delete the contact and add it for the other user.",
  security: [{ bearerAuth: [] }],
  request: {
    params: emergencyContactParamsSchema,
    body: {
      content: { "application/json": { schema: updateEmergencyContactSchema } },
    },
  },
  responses: {
    200: successResponse("Emergency contact updated successfully", emergencyContactResponseSchema),
    400: errorResponse("Validation error, or no fields provided"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Not the contact's owner and lacking users: update"),
    404: errorResponse("Emergency contact not found", NOT_FOUND_EXAMPLE),
  },
});

registry.registerPath({
  method: "delete",
  path: "/emergency-contacts/{id}",
  tags: ["Emergency Contacts"],
  summary: "Delete an emergency contact (its owner, or an admin with users: delete)",
  security: [{ bearerAuth: [] }],
  request: { params: emergencyContactParamsSchema },
  responses: {
    200: successResponse("Emergency contact deleted successfully"),
    400: errorResponse("Invalid emergency contact id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Not the contact's owner and lacking users: delete"),
    404: errorResponse("Emergency contact not found", NOT_FOUND_EXAMPLE),
  },
});
