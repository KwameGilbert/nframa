import { z } from "zod";
import { errorResponse, registry, successResponse } from "./registry.js";

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Check that the API and its database are up",
  description:
    'A health probe for load balancers, uptime monitors and apps that want to know whether the server is usable. No Authorization header is needed and the route is not rate limited. It runs a trivial query against Postgres (3 second limit) but does not call any outside service (payments, SMS, email, maps). A 200 means the server and its database both answer; data.version is the commit the running build came from ("dev" outside a built image). When the database does not answer it returns 503. A stopped or unreachable server simply doesn\'t answer, so treat a timeout or connection error as unhealthy too.',
  responses: {
    200: successResponse(
      "Service is healthy",
      z.object({
        status: z.literal("ok"),
        database: z.literal("ok"),
        version: z.string().meta({ example: "56300f5c1e2b" }),
      }),
    ),
    503: errorResponse("The database did not answer", "Database is unreachable"),
  },
});

registry.registerPath({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "Get the API welcome message and server time",
  description:
    "Public (no Authorization header, no rate limit). Returns data.status \"ok\", data.env (the NODE_ENV the server runs with, for example development or production; left out when it isn't set) and data.timestamp (the server's current time as an ISO 8601 UTC string), so a client can tell which environment it is talking to and compare the server clock with the device's. It does not touch the database.",
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
