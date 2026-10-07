import {
  OpenAPIRegistry,
  type OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { STATUS_CODES } from "node:http";
import { z } from "zod";
import { errorResponseSchema } from "../schemas/common.schema.js";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// Every 2xx response is { success: true, message, data } (utils/response.ts) — use this so each one documents
// the envelope: the message (also used as Swagger's label for the response, which OpenAPI requires) and the
// data schema (null when there's no payload).
export function successResponse(message: string, data: z.ZodType = z.null()) {
  const schema = z.object({
    success: z.literal(true),
    message: z.string().meta({ example: message }),
    data,
  });
  return { description: message, content: { "application/json": { schema } } };
}

// Every non-2xx response is { success: false, error } — use this so each one documents that body. Pass the
// exact message when the API returns a specific one; otherwise withErrorExamples() adds a default per status.
export function errorResponse(description: string, example?: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: errorResponseSchema,
        ...(example && { example: { success: false, error: example } }),
      },
    },
  };
}

export const rateLimitedResponse = errorResponse(
  "Too many requests — try again later (see the RateLimit headers for when)",
  "Too many requests, try again later",
);

// Default example message per error status, taken from real API messages. Keep the map in one place.
// 400 and 409 are derived per endpoint below; the 400 entry is only the fallback.
const DEFAULT_ERROR_EXAMPLES: Record<number, string> = {
  400: "Invalid request",
  401: "Invalid or expired access token",
  403: "Forbidden",
  404: "Not found",
  409: "A record with this value already exists",
  413: "request entity too large",
  429: "Too many requests, try again later",
  500: "Internal server error",
  502: "Payment provider request failed",
  503: "Service unavailable",
};

// Per path prefix (longest match wins): the table whose unique violation BaseModel.handleDbError reports in a
// 409 ("A <tableName> record with this value already exists"), and the permission module that guards it
// ("Missing permission: <action> on <module>", src/middlewares/authorize.ts). No module = no permission check.
const RESOURCES: Record<string, { table?: string; module?: string }> = {
  "/admin": { table: "adminUsers", module: "admin" },
  "/admin/activity-logs": { module: "activityLogs" },
  "/admin/broadcasts": { table: "broadcasts", module: "broadcasts" },
  "/admin/driver": { module: "verification" },
  "/admin/overview": { module: "overview" },
  "/admin/safety": { table: "sosIncidents", module: "sos" },
  "/admin/verification": { module: "verification" },
  "/commutes": { table: "driverCommutes", module: "commutes" },
  "/admin/payment-methods": { table: "paymentMethods", module: "users" },
  "/admin/payout-methods": { table: "payoutMethods", module: "payouts" },
  "/admin/reports": { table: "tripReports", module: "reports" },
  "/admin/support": { table: "supportTickets", module: "support" },
  "/admin/support/categories": { table: "supportCategories", module: "support" },
  "/devices": { table: "pushDevices" },
  "/document-types": { module: "verification" },
  "/driver": { table: "carOwnerProfiles", module: "users" },
  "/driver/verification": { module: "verification" },
  "/drivers": { table: "carOwnerProfiles", module: "users" },
  "/drivers/me/payouts": { table: "payouts" },
  "/emergency-contacts": { table: "emergencyContacts", module: "users" },
  "/notifications": { table: "notifications" },
  "/payment-methods": { table: "paymentMethods" },
  "/payout-methods": { table: "payoutMethods" },
  "/push": { table: "pushDevices" },
  "/reports": { table: "tripReports" },
  "/reviews": { table: "tripReviews", module: "users" },
  "/support": { table: "supportTickets" },
  "/rider": { table: "riderProfiles", module: "users" },
  "/roles": { table: "roles", module: "roles" },
  "/safety": { table: "sosIncidents" },
  "/settings": { table: "settings", module: "settings" },
  "/trips": { module: "trips" },
  "/trips/{tripId}/reports": { table: "tripReports" },
  "/users": { table: "users", module: "users" },
  "/vehicles": { table: "vehicles", module: "users" },
  "/verification": { module: "verification" },
  "/wallet": { table: "wallets" },
};

const ACTIONS: Record<string, string> = {
  get: "read",
  post: "create",
  put: "update",
  patch: "update",
  delete: "delete",
};

function resourceFor(path: string) {
  const prefix = Object.keys(RESOURCES)
    .filter((key) => path === key || path.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? RESOURCES[prefix] : undefined;
}

interface JsonSchema {
  type?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
}

interface Operation {
  parameters?: { name: string; in: string; required?: boolean; schema?: JsonSchema }[];
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
  responses: Record<string, { content?: Record<string, { example?: unknown }> }>;
}

// What validate() answers when this value is bad: zod's message for a missing/invalid value of this schema.
function invalidMessage(schema: JsonSchema, missing: boolean): string | undefined {
  if (schema.enum)
    return `Invalid option: expected one of ${schema.enum.map((v) => JSON.stringify(v)).join("|")}`;
  if (schema.format === "uuid" && !missing) return "Invalid UUID";
  if (!missing) {
    if (schema.minimum !== undefined) {
      return `Too small: expected number to be >${schema.exclusiveMinimum ? "" : "="}${schema.minimum}`;
    }
    if (schema.maximum !== undefined) {
      return `Too big: expected number to be <${schema.exclusiveMaximum ? "" : "="}${schema.maximum}`;
    }
    if (schema.minLength)
      return `Too small: expected string to have >=${schema.minLength} characters`;
    if (schema.maxLength)
      return `Too big: expected string to have <=${schema.maxLength} characters`;
  }
  const zodType = schema.type === "integer" ? "number" : schema.type;
  if (missing && zodType && ["string", "number", "boolean", "array", "object"].includes(zodType)) {
    return `Invalid input: expected ${zodType}, received undefined`;
  }
}

// validate() parses body, then query, then params, so the first failure is the body's first required
// field (sent missing), else the first constrained query param or path uuid (sent invalid).
function validationExample(operation: Operation): string | undefined {
  const content = operation.requestBody?.content;
  const body = (content?.["application/json"] ?? content?.["multipart/form-data"])?.schema;
  const field = body?.required?.[0];
  const missing = field && body.properties?.[field] && invalidMessage(body.properties[field], true);
  if (field && missing) return `${field}: ${missing}`;
  for (const location of ["query", "path"]) {
    for (const param of operation.parameters ?? []) {
      const message = param.in === location && param.schema && invalidMessage(param.schema, false);
      if (message) return `${param.name}: ${message}`;
    }
  }
}

function defaultExample(
  status: number,
  path: string,
  method: string,
  operation: Operation,
): string {
  if (status === 400) return validationExample(operation) ?? DEFAULT_ERROR_EXAMPLES[400];
  const resource = resourceFor(path);
  if (status === 409 && resource?.table) {
    return `A ${resource.table} record with this value already exists`;
  }
  if (status === 403) {
    return resource?.module
      ? `Missing permission: ${ACTIONS[method]} on ${resource.module}`
      : "Forbidden";
  }
  return DEFAULT_ERROR_EXAMPLES[status] ?? STATUS_CODES[status] ?? "Error";
}

type OpenApiDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;

// Gives every 4xx/5xx JSON response without an explicit example one that fits its status and endpoint, so
// Swagger never shows another status's (or another resource's) message.
export function withErrorExamples(document: OpenApiDocument): OpenApiDocument {
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem) as [string, Operation][]) {
      if (typeof operation !== "object" || !operation?.responses) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        const code = Number(status);
        if (!(code >= 400)) continue;
        const media = response.content?.["application/json"];
        if (!media || media.example !== undefined) continue;
        media.example = { success: false, error: defaultExample(code, path, method, operation) };
      }
    }
  }
  return document;
}
