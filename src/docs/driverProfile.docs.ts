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
  summary: "List every driver, each with their user, vehicles and documents (needs users: read)",
  description:
    "For staff. Returns every driver whose account isn't deleted in one response, with no pagination or filters, each in the full driver shape: the profile, the user record (phone, email and date of birth included), all their vehicles (newest first, retired ones too) and their verification documents (newest first, deleted ones left out). The order follows the user id, so it means nothing: sort on the client, or use the by-code and by-phone lookups to find one driver. A deleted account is left out of this list, but GET /driver/{userId} still returns it if you have the id.",
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
    "Creates the driver-specific record that vehicles, commutes, document verification and trip bookings depend on, so a driver creates it right after signing up (the profile on the signed-in user, from login or GET /auth/me, is null until then). userId must be the caller's own id, otherwise the caller needs users: create (403), and it must be an existing user (400). Each user can have one profile (409). ghanaCardNumber and address are optional non-empty text, not format-checked, and can be filled in later with PATCH /driver/{userId}. The server generates a unique driver code (DR- and six characters, such as DR-7KQ2MX) that staff use to find the driver. verificationStatus starts as unverified, isOnline and autoAcceptBookings start false, and none of them can be set here. Create the profile before uploading verification documents: the driver's status only moves to pending for users who have a profile. Returns the full driver shape with empty vehicles and documents, and is recorded in the audit trail.",
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
  description:
    "Returns the profile with the user record, vehicles (newest first, retired ones too) and verification documents (newest first, deleted ones left out), the same shape every driver endpoint uses. A driver can read only their own profile; anyone else needs users: read and gets 403, even for an id that has no driver profile. 404 means the user id has no driver profile, for example a rider's id or a driver who hasn't called POST /driver yet. A driver whose account was deleted is still returned. A staff member viewing someone else's profile is recorded in the audit trail; reading your own isn't.",
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
    404: errorResponse(
      "Driver profile not found",
      "Driver profile not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/drivers/code/{code}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by driver code (needs users: read)",
  description:
    "For staff to resolve a driver code that a driver reads out or quotes (for example DR-7KQ2MX, shown as code on the driver's profile). The code must match exactly and is case-sensitive, so send it uppercase as issued. Returns the full driver shape, including a driver whose account was deleted. 404 when no driver has this code. Each lookup is recorded in the audit trail as a view of that driver.",
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
    404: errorResponse("No driver with this code", "Driver not found with code: DR-7KQ2MX"),
  },
});

registry.registerPath({
  method: "get",
  path: "/drivers/phone/{phoneCountryCode}/{phoneNumber}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by phone number (needs users: read)",
  description:
    "For staff to find a driver from the phone number they called or texted from. Send the country calling code with its + (such as +233) and the number without the country code (such as 541436414); both must match what is stored on the account exactly, with no trimming or reformatting. Returns the full driver shape, including a driver whose account was deleted. 404 when no driver has this number, which is also the answer for a rider's number. Each lookup is recorded in the audit trail as a view of that driver.",
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
    404: errorResponse(
      "No driver with this phone number",
      "Driver not found with phone: +233541436414",
    ),
  },
});

registry.registerPath({
  method: "patch",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Update a driver profile (the driver themselves, or an admin with users: update)",
  description:
    "Send only the fields to change, at least one (a body with none of the editable fields is a 400, and other fields such as verificationStatus or code are ignored, not applied). Editable: ghanaCardNumber and address (non-empty text), isOnline (the availability flag the driver app switches; it is stored and shown to staff, and doesn't currently hide the driver's commutes from riders) and autoAcceptBookings (true: a rider's new trip request on this driver's commutes is accepted immediately and the fare is held in the rider's wallet; false: requests wait as pending until the driver accepts or declines them). Changing the Ghana card number or address doesn't affect verificationStatus. verificationStatus changes only through document review and PATCH /admin/driver/{userId}/verification, and the user's name, phone and email through PATCH /users/{id}, which can also send these driver fields in the same transaction. A driver can edit their own profile; anyone else needs users: update and gets 403 otherwise. 404 when the user has no driver profile. Returns the updated full driver shape and is recorded in the audit trail with the before and after.",
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
    404: errorResponse(
      "Driver profile not found",
      "Driver profile not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});
