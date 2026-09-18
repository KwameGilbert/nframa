import { registry } from "./registry.js";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  driverProfileParamsSchema,
  driverProfileResponseSchema,
} from "../schemas/driverProfile.schema.js";

registry.registerPath({
  method: "post",
  path: "/driver",
  tags: ["Driver Profiles"],
  summary: "Create a driver profile",
  request: {
    body: {
      content: { "application/json": { schema: createDriverProfileSchema } },
    },
  },
  responses: {
    201: {
      description: "Driver profile created",
      content: { "application/json": { schema: driverProfileResponseSchema } },
    },
    400: { description: "Validation error" },
    409: { description: "Driver profile already exists for this user" },
  },
});

registry.registerPath({
  method: "get",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Get a driver profile by user id",
  request: {
    params: driverProfileParamsSchema,
  },
  responses: {
    200: {
      description: "The driver profile",
      content: { "application/json": { schema: driverProfileResponseSchema } },
    },
    400: { description: "Validation error" },
    404: { description: "Driver profile not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/driver/{userId}",
  tags: ["Driver Profiles"],
  summary: "Update a driver profile",
  request: {
    params: driverProfileParamsSchema,
    body: {
      content: { "application/json": { schema: updateDriverProfileSchema } },
    },
  },
  responses: {
    200: {
      description: "The updated driver profile",
      content: { "application/json": { schema: driverProfileResponseSchema } },
    },
    400: { description: "Validation error" },
    404: { description: "Driver profile not found" },
  },
});
