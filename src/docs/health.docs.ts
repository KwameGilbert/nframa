import { z } from "zod";
import { registry } from "./registry.js";

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: {
      description: "Service is up",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "API welcome message",
  responses: {
    200: {
      description: "Welcome payload",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            message: z.string(),
            env: z.string().optional(),
            timestamp: z.iso.datetime(),
          }),
        },
      },
    },
  },
});
