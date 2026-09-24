import { z } from "zod";
import { registry, successResponse } from "./registry.js";

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: successResponse("Service is healthy", z.object({ status: z.literal("ok") })),
  },
});

registry.registerPath({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "API welcome message",
  responses: {
    200: successResponse(
      "Welcome to the Nframa API",
      z.object({
        status: z.literal("ok"),
        env: z.string().optional().meta({ example: "development" }),
        timestamp: z.iso.datetime(),
      }),
    ),
  },
});
