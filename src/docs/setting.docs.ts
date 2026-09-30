import { errorResponse, registry, successResponse } from "./registry.js";
import {
  createSettingSchema,
  getSettingQuerySchema,
  settingKeyParamsSchema,
  settingResponseSchema,
  settingWithHistoryResponseSchema,
  updateSettingSchema,
} from "../schemas/setting.schema.js";

const unauthorized = errorResponse("Missing or invalid access token");
const missingPermission = (action: string) => errorResponse(`Caller lacks settings: ${action}`);
const notFound = errorResponse("Setting not found", "Setting not found: fares.baseFare");

registry.registerPath({
  method: "get",
  path: "/settings",
  tags: ["Settings"],
  summary: "List settings",
  description: "Every setting, ordered by key. Needs settings: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Settings retrieved successfully", settingResponseSchema.array()),
    401: unauthorized,
    403: missingPermission("read"),
  },
});

registry.registerPath({
  method: "post",
  path: "/settings",
  tags: ["Settings"],
  summary: "Create a setting",
  description:
    "value must match type. The key and type can't be changed later — delete and recreate the setting instead. Needs settings: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createSettingSchema } },
    },
  },
  responses: {
    201: successResponse("Setting created successfully", settingResponseSchema),
    400: errorResponse(
      "Validation error (e.g. a badly formed key, or a value that doesn't match type)",
    ),
    401: unauthorized,
    403: missingPermission("create"),
    409: errorResponse(
      "A setting with this key already exists",
      "Setting already exists: fares.baseFare",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/{key}",
  tags: ["Settings"],
  summary: "Get a setting with its change history",
  description:
    "The setting, plus `history`: its most recent changes, newest first, each naming who made it and what the setting looked like before and after. The history is read from the audit trail, so it starts where activity logging did and covers only changes that went through — refused attempts never appear. Use historyLimit to ask for more or fewer entries. Needs settings: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: settingKeyParamsSchema,
    query: getSettingQuerySchema,
  },
  responses: {
    200: successResponse("Setting retrieved successfully", settingWithHistoryResponseSchema),
    400: errorResponse("Validation error (e.g. historyLimit outside 1-100)"),
    401: unauthorized,
    403: missingPermission("read"),
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/settings/{key}",
  tags: ["Settings"],
  summary: "Update a setting's value and/or description",
  description:
    "Send value, description, or both. value must match the setting's type. Send description: null to clear it. Needs settings: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: settingKeyParamsSchema,
    body: {
      content: { "application/json": { schema: updateSettingSchema } },
    },
  },
  responses: {
    200: successResponse("Setting updated successfully", settingResponseSchema),
    400: errorResponse(
      "Validation error (e.g. a value that doesn't match the setting's type)",
      "key: Key must be camelCase segments separated by dots, each starting with a lowercase letter (e.g. fares.baseFare)",
    ),
    401: unauthorized,
    403: missingPermission("update"),
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/{key}",
  tags: ["Settings"],
  summary: "Delete a setting",
  description: "Needs settings: delete.",
  security: [{ bearerAuth: [] }],
  request: {
    params: settingKeyParamsSchema,
  },
  responses: {
    200: successResponse("Setting deleted successfully"),
    400: errorResponse(
      "Validation error",
      "key: Key must be camelCase segments separated by dots, each starting with a lowercase letter (e.g. fares.baseFare)",
    ),
    401: unauthorized,
    403: missingPermission("delete"),
    404: notFound,
  },
});
