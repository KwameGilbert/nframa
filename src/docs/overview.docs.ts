import { errorResponse, successResponse, registry } from "./registry.js";
import { overviewQuerySchema, overviewResponseSchema } from "../schemas/overview.schema.js";

registry.registerPath({
  method: "get",
  path: "/admin/overview",
  tags: ["Overview"],
  summary: "Get the dashboard overview",
  description:
    "Everything the admin dashboard home shows, in one call: headline counts (active riders and car owners, trips completed and revenue today, open SOS incidents, documents awaiting verification, open support tickets), how they compare with yesterday, completed vs cancelled trips per day for the last `days` days, the verification queue by document group, and the 20 newest successful admin changes. Days are UTC. Needs overview: read.",
  security: [{ bearerAuth: [] }],
  request: { query: overviewQuerySchema },
  responses: {
    200: successResponse("Overview retrieved successfully", overviewResponseSchema),
    400: errorResponse("days is not a whole number from 1 to 30"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on overview"),
  },
});
