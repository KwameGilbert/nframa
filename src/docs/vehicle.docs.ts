import { errorResponse, registry, successResponse } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createVehicleSchema,
  updateVehicleSchema,
  vehicleResponseSchema,
} from "../schemas/vehicle.schema.js";

registry.registerPath({
  method: "post",
  path: "/vehicles",
  tags: ["Vehicles"],
  summary: "Create a vehicle (for yourself, or anyone with users: create)",
  description:
    "carOwnerUserId must be the caller's own id unless the caller has users: create. New vehicles start with status active and isVerified false.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createVehicleSchema } },
    },
  },
  responses: {
    201: successResponse("Vehicle created successfully", vehicleResponseSchema),
    400: errorResponse("Validation error, or carOwnerUserId doesn't match an existing user"),
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
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: successResponse("Vehicle retrieved successfully", vehicleResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller doesn't own this vehicle and lacks users: read"),
    404: errorResponse("Vehicle not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Update a vehicle (its owner, or an admin with users: update)",
  description: "Send only the fields to change (at least one).",
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
    404: errorResponse("Vehicle not found"),
    409: errorResponse("Another vehicle already has this plate"),
  },
});
