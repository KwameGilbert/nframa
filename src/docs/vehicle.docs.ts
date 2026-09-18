import { registry } from "./registry.js";
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
  summary: "Create a vehicle",
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
    400: { description: "Validation error" },
    409: { description: "A vehicle with this plate already exists" },
  },
});

registry.registerPath({
  method: "get",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Get a vehicle by id",
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: "The vehicle",
      content: { "application/json": { schema: vehicleResponseSchema } },
    },
    400: { description: "Validation error" },
    404: { description: "Vehicle not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/vehicles/{id}",
  tags: ["Vehicles"],
  summary: "Update a vehicle",
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
    400: { description: "Validation error" },
    404: { description: "Vehicle not found" },
  },
});
