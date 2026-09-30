import { errorResponse, registry, successResponse } from "./registry.js";
import { estimateFareSchema, fareEstimateResponseSchema } from "../schemas/fare.schema.js";

registry.registerPath({
  method: "post",
  path: "/fares/estimate",
  tags: ["Fares"],
  summary: "Estimate the fare for a trip between two points (any signed-in user)",
  description:
    "Distance and duration come from Google routing when it is configured and available, otherwise from the straight-line distance at the trips.fallbackSpeedKmh setting (see routeSource). The rider pays fare + platformFee + bookingFee; the driver earns the fare. Rates and fees are the fares.* and fees.* settings.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: estimateFareSchema } } },
  },
  responses: {
    200: successResponse("Fare estimated successfully", fareEstimateResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
  },
});
