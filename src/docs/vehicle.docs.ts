import { errorResponse, registry } from "./registry.js";
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
  summary: "Create a vehicle (for yourself, or any user as an admin)",
  description:
    "carOwnerUserId must be the caller's own id unless the caller is an admin. New vehicles start with status active and isVerified false.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createVehicleSchema } },
    },
  },
  responses: {
    201: {
      description: "Vehicle created",
      content: { "application/json": { schema: vehicleResponseSchema } },
    },
    400: errorResponse("Validation error, or carOwnerUserId doesn't match an existing user"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("carOwnerUserId isn't the caller and the caller isn't an admin"),
    409: errorResponse("A vehicle with this plate already exists"),
  },
});

registry.registerPath({
  method: "get",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Get a vehicle by id (its owner, or an admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: "The vehicle",
      content: { "application/json": { schema: vehicleResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller doesn't own this vehicle and isn't an admin"),
    404: errorResponse("Vehicle not found"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Update a vehicle (its owner, or an admin)",
  description: "Send only the fields to change (at least one).",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
    body: {
      content: { "application/json": { schema: updateVehicleSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated vehicle",
      content: { "application/json": { schema: vehicleResponseSchema } },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller doesn't own this vehicle and isn't an admin"),
    404: errorResponse("Vehicle not found"),
    409: errorResponse("Another vehicle already has this plate"),
  },
});
