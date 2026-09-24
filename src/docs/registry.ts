import { OpenAPIRegistry, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
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

// Every non-2xx response is { success: false, error } — use this so each one documents that body.
export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: errorResponseSchema } } };
}

export const rateLimitedResponse = errorResponse(
  "Too many requests — try again later (see the RateLimit headers for when)",
);
