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
    "Returns the caller's contacts, oldest first, as a plain list (there is no pagination, and no limit on how many a user can have); a user with none gets an empty array. Pass userId to list someone else's, which needs users: read (403 otherwise); passing your own id needs no permission. The same contacts also appear as emergencyContacts on GET /users/{id}. Reading isn't recorded in the audit trail.",
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
    "Saves a person to reach if the user raises an SOS alert. name is 1 to 100 characters, phoneCountryCode is the calling code with its + (such as +233), phoneNumber is 9 to 15 characters without the country code, and relationship is free text of 1 to 50 characters (such as Sister); name, phoneNumber and relationship are trimmed. The contact is for the caller unless userId is set; setting it to someone else needs users: create (403) and must be an existing user (400). The number is not verified and nothing is sent to the contact, there is no limit on how many contacts a user can add, and duplicates are not rejected. When an SOS alert is raised (POST /safety/sos), the user's contacts at that moment are copied onto the alert for the safety desk, so adding, editing or removing a contact later doesn't change an alert that already exists. Returns the new contact and is recorded in the audit trail.",
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
  description:
    "Returns one contact. The user it belongs to can read it; anyone else needs users: read. An id that doesn't exist answers 404 to every caller, while a contact that exists but belongs to another user answers 403. Reading isn't recorded in the audit trail.",
  security: [{ bearerAuth: [] }],
  request: { params: emergencyContactParamsSchema },
  responses: {
    200: successResponse(
      "Emergency contact retrieved successfully",
      emergencyContactResponseSchema,
    ),
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
  description:
    "Send only the fields to change, at least one of name, phoneCountryCode, phoneNumber and relationship, under the same limits as when adding (a body with none of these is a 400). The owner can't be changed: a userId in the body is ignored, so delete the contact and add it for the other user instead. The owner or an admin with users: update can edit; an id that doesn't exist answers 404 to every caller, while another user's contact answers 403. An SOS alert that was already raised keeps the contacts it was raised with. Returns the updated contact and is recorded in the audit trail with the before and after.",
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
  description:
    "Removes the contact permanently, with no way to undo it. The owner or an admin with users: delete can delete; an id that doesn't exist answers 404 to every caller, while another user's contact answers 403. An SOS alert that was already raised keeps the contacts it was raised with. Returns no data and is recorded in the audit trail with the contact as it was.",
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
