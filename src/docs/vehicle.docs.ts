import { errorResponse, registry, successResponse } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createVehicleMultipartSchema,
  replaceVehiclePhotoMultipartSchema,
  updateVehicleSchema,
  vehiclePhotoParamsSchema,
  vehicleResponseSchema,
} from "../schemas/vehicle.schema.js";

registry.registerPath({
  method: "post",
  path: "/vehicles",
  tags: ["Vehicles"],
  summary: "Create a vehicle (for yourself, or anyone with users: create)",
  description:
    "Registers a car for a driver, with a photo of each side. Send multipart/form-data: the details as form fields and one JPEG, PNG or WEBP image (5MB each) under each of front, back, left and right; all four are required (400 naming the missing ones). If anything fails after the photos are stored (e.g. a duplicate plate), they are deleted again. carOwnerUserId must be the caller's own id, otherwise the caller needs users: create (403), and it must be an existing user (400). make, model, color and plate are required non-empty text, seats a whole number of at least 1, and year is optional. plate is unique across all vehicles and compared exactly as written, so case and spaces matter and a clash answers 409. A driver can register several vehicles, and a driver profile isn't needed first. New vehicles start with status active, isVerified false and verificationDate null; none of these can be set through this API, and there is no list, delete or retire route. A driver's vehicles come back inside GET /driver/{userId} (newest first), and riders see the driver's newest active vehicle (verified ones first) on a trip. A commute doesn't name a vehicle and sets its own capacity, which isn't checked against seats. Returns the new vehicle and is recorded in the audit trail.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "multipart/form-data": { schema: createVehicleMultipartSchema } },
    },
  },
  responses: {
    201: successResponse("Vehicle created successfully", vehicleResponseSchema),
    400: errorResponse(
      'Validation error, a missing or unsupported photo ("Add a photo of each side of the vehicle; missing: left, right"), or carOwnerUserId doesn\'t match an existing user',
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("carOwnerUserId isn't the caller and the caller lacks users: create"),
    409: errorResponse("A vehicle with this plate already exists"),
  },
});

registry.registerPath({
  method: "get",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Get a vehicle by id (its owner, or an admin with users: read)",
  description:
    "Returns one vehicle. The owner can read it; anyone else needs users: read. An id that doesn't exist answers 404 to every caller, while a vehicle that exists but belongs to someone else answers 403. There is no endpoint that lists vehicles: take the ids from the vehicles array of GET /driver/{userId}, or from the response to POST /vehicles. Reading isn't recorded in the audit trail.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: successResponse("Vehicle retrieved successfully", vehicleResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller doesn't own this vehicle and lacks users: read"),
    404: errorResponse(
      "Vehicle not found",
      "Vehicle not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "patch",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Update a vehicle (its owner, or an admin with users: update)",
  description:
    "Send only the fields to change, at least one of make, model, year, color, plate and seats, under the same rules as when creating (a body with none of these is a 400). The owner, status, isVerified and verificationDate can't be changed here, and sending them is ignored rather than rejected, so a vehicle can't be moved to another driver. Changing plate to one that another vehicle already has answers 409. The owner or an admin with users: update can edit; an id that doesn't exist answers 404 to every caller, while someone else's vehicle answers 403. Returns the updated vehicle and is recorded in the audit trail with the before and after.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
    body: {
      content: { "application/json": { schema: updateVehicleSchema } },
    },
  },
  responses: {
    200: successResponse("Vehicle updated successfully", vehicleResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller doesn't own this vehicle and lacks users: update"),
    404: errorResponse(
      "Vehicle not found",
      "Vehicle not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    409: errorResponse("Another vehicle already has this plate"),
  },
});

registry.registerPath({
  method: "put",
  path: "/vehicles/{id}/photos/{side}",
  tags: ["Vehicles"],
  summary: "Replace one of a vehicle's photos (its owner, or an admin with users: update)",
  description:
    "side is front, back, left or right. Send multipart/form-data with the new image (JPEG, PNG or WEBP, 5MB) under the photo field. The old photo's file is deleted once the change is saved. Works for older vehicles that have no photos yet, one side at a time. An id that doesn't exist answers 404 to every caller, while someone else's vehicle answers 403. Returns the vehicle and is recorded in the audit trail (vehicle.photo).",
  security: [{ bearerAuth: [] }],
  request: {
    params: vehiclePhotoParamsSchema,
    body: { content: { "multipart/form-data": { schema: replaceVehiclePhotoMultipartSchema } } },
  },
  responses: {
    200: successResponse("Vehicle photo replaced successfully", vehicleResponseSchema),
    400: errorResponse(
      "Validation error (e.g. an unknown side), or no photo, or an unsupported or too-large image",
      "Send the new photo as multipart/form-data under the 'photo' field",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller doesn't own this vehicle and lacks users: update"),
    404: errorResponse(
      "Vehicle not found",
      "Vehicle not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});
