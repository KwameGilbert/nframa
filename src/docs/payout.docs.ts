import { registry, errorResponse, successResponse } from "./registry.js";
import {
  adminListPayoutMethodsQuerySchema,
  createPayoutMethodSchema,
  payoutMethodListResponseSchema,
  payoutMethodPageResponseSchema,
  payoutMethodParamsSchema,
  payoutMethodResponseSchema,
  updatePayoutMethodSchema,
} from "../schemas/payout.schema.js";

const TAG = "Payout methods";
const NOT_FOUND = errorResponse(
  "No such payout method",
  "Payout method not found: 5f0c9c1e-8d3a-4b7e-9a52-6a1f0f3b2c11",
);

registry.registerPath({
  method: "post",
  path: "/payout-methods",
  tags: [TAG],
  summary: "Choose where my earnings are paid",
  description:
    "Drivers only. Points at one of the driver's own verified mobile money or bank account payment methods, and says whether payouts are automatic (and from what balance, how often). Only the settings are stored for now — no money moves until payouts are integrated. The first one becomes the primary.",
  request: { body: { content: { "application/json": { schema: createPayoutMethodSchema } } } },
  responses: {
    201: successResponse("Payout method added successfully", payoutMethodResponseSchema),
    400: errorResponse("A card can't receive payouts", "Payouts go to a mobile money number or a bank account, not a card"),
    403: errorResponse("Not a driver", "Only drivers can set up payouts"),
    404: errorResponse(
      "Not one of the driver's payment methods",
      "Payment method not found: 5f0c9c1e-8d3a-4b7e-9a52-6a1f0f3b2c11",
    ),
    409: errorResponse("Not verified, or already a payout method", "Verify this payment method before using it for payouts"),
  },
});

registry.registerPath({
  method: "get",
  path: "/payout-methods",
  tags: [TAG],
  summary: "List my payout methods",
  description: "Primary first, then newest.",
  responses: {
    200: successResponse("Payout methods retrieved successfully", payoutMethodListResponseSchema),
  },
});

registry.registerPath({
  method: "patch",
  path: "/payout-methods/{id}",
  tags: [TAG],
  summary: "Change my payout settings or primary method",
  request: {
    params: payoutMethodParamsSchema,
    body: { content: { "application/json": { schema: updatePayoutMethodSchema } } },
  },
  responses: {
    200: successResponse("Payout method updated successfully", payoutMethodResponseSchema),
    404: NOT_FOUND,
    409: errorResponse(
      "Its payment method isn't verified",
      "Only a verified payment method can be the primary payout method",
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/payout-methods/{id}",
  tags: [TAG],
  summary: "Remove a payout method",
  description: "The payment method itself stays. If it was the primary, the newest remaining one takes over.",
  request: { params: payoutMethodParamsSchema },
  responses: {
    200: successResponse("Payout method removed successfully"),
    404: NOT_FOUND,
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/payout-methods",
  tags: [TAG],
  summary: "List drivers' payout methods",
  description: "Needs payouts: read.",
  request: { query: adminListPayoutMethodsQuerySchema },
  responses: {
    200: successResponse("Payout methods retrieved successfully", payoutMethodPageResponseSchema),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/payout-methods/{id}",
  tags: [TAG],
  summary: "Change a driver's payout settings",
  description: "Needs payouts: update.",
  request: {
    params: payoutMethodParamsSchema,
    body: { content: { "application/json": { schema: updatePayoutMethodSchema } } },
  },
  responses: {
    200: successResponse("Payout method updated successfully", payoutMethodResponseSchema),
    404: NOT_FOUND,
    409: errorResponse(
      "Its payment method isn't verified",
      "Only a verified payment method can be the primary payout method",
    ),
  },
});
