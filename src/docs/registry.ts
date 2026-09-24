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

// Every non-2xx response carries { error: string } — use this so each one documents that body.
export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: errorResponseSchema } } };
}

export const rateLimitedResponse = errorResponse(
  "Too many requests — try again later (see the RateLimit headers for when)",
);
