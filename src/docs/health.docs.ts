import { z } from "zod";
import { registry, successResponse } from "./registry.js";

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Check that the API is up",
  description:
    "A liveness probe for load balancers, uptime monitors and apps that want to know whether the server is reachable. No Authorization header is needed and the route is not rate limited. It only proves that the server process is running and answering: it does not query the database or any outside service (payments, SMS, email, maps), so a 200 does not mean Postgres is reachable. It always answers 200 with data.status \"ok\"; a stopped or unreachable server simply doesn't answer, so treat a timeout or connection error as unhealthy.",
  responses: {
    200: successResponse("Service is healthy", z.object({ status: z.literal("ok") })),
  },
});

registry.registerPath({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "Get the API welcome message and server time",
  description:
    "Public (no Authorization header, no rate limit). Returns data.status \"ok\", data.env (the NODE_ENV the server runs with, for example development or production; left out when it isn't set) and data.timestamp (the server's current time as an ISO 8601 UTC string), so a client can tell which environment it is talking to and compare the server clock with the device's. Like GET /health it does not touch the database.",
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
