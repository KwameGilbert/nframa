import { registry, successResponse, errorResponse } from "./registry.js";
import {
  createPayoutMethodSchema,
  updatePayoutMethodSchema,
  payoutMethodResponseSchema,
  payoutHistoryListResponseSchema,
  payoutStatsResponseSchema,
} from "../schemas/payout.schema.js";
import { z } from "zod";

registry.register("PayoutMethod", payoutMethodResponseSchema);
registry.register("PayoutHistory", payoutHistoryListResponseSchema);
registry.register("PayoutStats", payoutStatsResponseSchema);

registry.registerPath({
  method: "post",
  path: "/payouts/methods",
  description:
    "Driver: Add a verified payment method to receive automatic or manual payouts (Hubtel/Paystack)",
  request: { body: { content: { "application/json": { schema: createPayoutMethodSchema } } } },
  responses: {
    201: successResponse("Payout method added successfully", payoutMethodResponseSchema),
    400: errorResponse("Payment method not verified or not found"),
    403: errorResponse("Only drivers can add payout methods"),
    409: errorResponse("Payment method already linked"),
  },
  tags: ["payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payouts/methods",
  description: "Driver: List configured payout methods with auto-payout settings",
  responses: {
    200: successResponse("Payout methods retrieved successfully", payoutMethodResponseSchema),
    403: errorResponse("Only drivers can view payout methods"),
  },
  tags: ["payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "patch",
  path: "/payouts/methods/{id}",
  description: "Driver: Update payout method (set primary, enable/disable automatic, adjust threshold)",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: updatePayoutMethodSchema } } },
  },
  responses: {
    200: successResponse("Payout method updated successfully", payoutMethodResponseSchema),
    404: errorResponse("Payout method not found"),
  },
  tags: ["payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "post",
  path: "/payouts/methods/{id}/trigger",
  description:
    "Driver: Manually trigger immediate payout to verified payment method using available wallet balance",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: successResponse("Payout initiated successfully", payoutMethodResponseSchema),
    400: errorResponse("Insufficient balance or payment method not verified"),
    404: errorResponse("Payout method not found"),
    409: errorResponse("Transfer failed"),
  },
  tags: ["payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payouts/history",
  description: "Driver: View payout history with optional status filter",
  request: {
    query: z.object({
      status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
      initiationType: z.enum(["manual", "automatic"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: successResponse("Payout history retrieved successfully", payoutHistoryListResponseSchema),
  },
  tags: ["payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payouts/stats",
  description: "Driver: View payout statistics (total paid, pending, failed, last payout date)",
  responses: {
    200: successResponse("Payout statistics retrieved successfully", payoutStatsResponseSchema),
  },
  tags: ["payouts"],
  security: [{ bearer: [] }],
});

// Admin endpoints
registry.registerPath({
  method: "get",
  path: "/payouts/admin/users/{driverId}/methods",
  description: "Admin: View driver's payout methods and settings",
  request: { params: z.object({ driverId: z.string().uuid() }) },
  responses: {
    200: successResponse("Payout methods retrieved successfully"),
    403: errorResponse("Missing permission: read on users"),
    404: errorResponse("Driver not found"),
  },
  tags: ["admin", "payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payouts/admin/history",
  description: "Admin: View all payout history with optional filtering",
  request: {
    query: z.object({
      driverId: z.string().uuid().optional(),
      status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: successResponse("Payout history retrieved successfully", payoutHistoryListResponseSchema),
    403: errorResponse("Missing permission: read on payouts"),
  },
  tags: ["admin", "payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payouts/admin/users/{driverId}/history",
  description: "Admin: View specific driver's payout history",
  request: {
    params: z.object({ driverId: z.string().uuid() }),
    query: z.object({
      status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: successResponse("Payout history retrieved successfully", payoutHistoryListResponseSchema),
    403: errorResponse("Missing permission: read on payouts"),
  },
  tags: ["admin", "payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "post",
  path: "/payouts/admin/users/{driverId}/trigger",
  description: "Admin: Manually trigger payout for driver using their primary method and wallet balance",
  request: { params: z.object({ driverId: z.string().uuid() }) },
  responses: {
    200: successResponse("Payout initiated successfully"),
    400: errorResponse("No primary payout method or insufficient balance"),
    403: errorResponse("Missing permission: update on payouts"),
    404: errorResponse("Driver not found"),
    409: errorResponse("Transfer failed"),
  },
  tags: ["admin", "payouts"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payouts/admin/users/{driverId}/stats",
  description: "Admin: View driver payout statistics",
  request: { params: z.object({ driverId: z.string().uuid() }) },
  responses: {
    200: successResponse("Payout statistics retrieved successfully", payoutStatsResponseSchema),
    403: errorResponse("Missing permission: read on payouts"),
  },
  tags: ["admin", "payouts"],
  security: [{ bearer: [] }],
});
