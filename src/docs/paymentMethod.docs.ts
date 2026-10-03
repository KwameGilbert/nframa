import { registry, successResponse, errorResponse } from "./registry.js";
import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  verifyPaymentMethodSchema,
  paymentMethodResponseSchema,
  paymentMethodListResponseSchema,
  adminUpdatePaymentMethodSchema,
} from "../schemas/paymentMethod.schema.js";
import { z } from "zod";

registry.register("PaymentMethod", paymentMethodResponseSchema);
registry.register("PaymentMethodList", paymentMethodListResponseSchema);

registry.registerPath({
  method: "post",
  path: "/payment-methods",
  description: "Add a new payment method (card, mobile money, or bank account) for topups or payouts",
  request: { body: { content: { "application/json": { schema: createPaymentMethodSchema } } } },
  responses: {
    201: successResponse("Payment method added successfully", paymentMethodResponseSchema),
    400: errorResponse("Invalid payment details or provider error"),
    409: errorResponse("Payment method already exists"),
  },
  tags: ["payment-methods"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payment-methods",
  description: "List user's payment methods with optional filtering by verification status",
  request: {
    query: z.object({
      verified: z.coerce.boolean().optional(),
      active: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: successResponse("Payment methods retrieved successfully", paymentMethodListResponseSchema),
    401: errorResponse("Unauthorized"),
  },
  tags: ["payment-methods"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "get",
  path: "/payment-methods/{id}",
  description: "Get details of a specific payment method including verification status",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: successResponse("Payment method retrieved successfully", paymentMethodResponseSchema),
    404: errorResponse("Payment method not found"),
    403: errorResponse("Not your payment method"),
  },
  tags: ["payment-methods"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "patch",
  path: "/payment-methods/{id}",
  description: "Update payment method name or set as primary",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: updatePaymentMethodSchema } } },
  },
  responses: {
    200: successResponse("Payment method updated successfully", paymentMethodResponseSchema),
    404: errorResponse("Payment method not found"),
  },
  tags: ["payment-methods"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "post",
  path: "/payment-methods/{id}/verify",
  description:
    "Verify payment method with OTP or challenge token from payment provider (Hubtel/Paystack)",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: verifyPaymentMethodSchema } } },
  },
  responses: {
    200: successResponse("Payment method verified successfully", paymentMethodResponseSchema),
    400: errorResponse("Verification failed"),
    404: errorResponse("Payment method not found"),
  },
  tags: ["payment-methods"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "delete",
  path: "/payment-methods/{id}",
  description: "Remove a payment method (soft delete — sets isActive to false)",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: successResponse("Payment method removed successfully"),
    404: errorResponse("Payment method not found"),
  },
  tags: ["payment-methods"],
  security: [{ bearer: [] }],
});

// Admin endpoints
registry.registerPath({
  method: "get",
  path: "/payment-methods/admin/users",
  description: "Admin: List all payment methods with optional filtering",
  request: {
    query: z.object({
      userId: z.string().uuid().optional(),
      verified: z.coerce.boolean().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: successResponse("Payment methods retrieved successfully", paymentMethodListResponseSchema),
    403: errorResponse("Missing permission: read on users"),
  },
  tags: ["admin", "payment-methods"],
  security: [{ bearer: [] }],
});

registry.registerPath({
  method: "patch",
  path: "/payment-methods/admin/users/{userId}/{id}",
  description: "Admin: Force update or verify a user's payment method",
  request: {
    params: z.object({ userId: z.string().uuid(), id: z.string().uuid() }),
    body: { content: { "application/json": { schema: adminUpdatePaymentMethodSchema } } },
  },
  responses: {
    200: successResponse("Payment method updated successfully", paymentMethodResponseSchema),
    403: errorResponse("Missing permission: update on users"),
    404: errorResponse("Payment method not found"),
  },
  tags: ["admin", "payment-methods"],
  security: [{ bearer: [] }],
});
