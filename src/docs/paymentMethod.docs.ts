import { registry, errorResponse, successResponse } from "./registry.js";
import {
  adminListPaymentMethodsQuerySchema,
  adminUpdatePaymentMethodSchema,
  createPaymentMethodSchema,
  listPaymentMethodsQuerySchema,
  paymentMethodListResponseSchema,
  paymentMethodPageResponseSchema,
  paymentMethodParamsSchema,
  paymentMethodResponseSchema,
  updatePaymentMethodSchema,
} from "../schemas/paymentMethod.schema.js";

const TAG = "Payment methods";
const NOT_FOUND = errorResponse(
  "No such payment method of yours",
  "Payment method not found: 5f0c9c1e-8d3a-4b7e-9a52-6a1f0f3b2c11",
);

registry.registerPath({
  method: "post",
  path: "/payment-methods",
  tags: [TAG],
  summary: "Save a payment method",
  description:
    "Riders and drivers save a card, a mobile money number or a bank account. Cards are only described (brand, last four digits, expiry) — never send a full card number or CVV, they're refused. It starts as `pending`; staff verify it for now, and the payment provider will once charging is integrated. Full numbers are stored but never returned: responses show them masked to the last four digits. Details can't be edited — remove it and save a new one, which has to be verified again. Saving the same one twice answers `409`.",
  request: { body: { content: { "application/json": { schema: createPaymentMethodSchema } } } },
  responses: {
    201: successResponse("Payment method saved successfully", paymentMethodResponseSchema),
    400: errorResponse("Invalid details, or an extra field such as a card number"),
    403: errorResponse("Admins can't save payment methods", "Only riders and drivers can save payment methods"),
    409: errorResponse("Already saved", "You have already saved this payment method"),
  },
});

registry.registerPath({
  method: "get",
  path: "/payment-methods",
  tags: [TAG],
  summary: "List my payment methods",
  description: "Your own, primary first, then newest.",
  request: { query: listPaymentMethodsQuerySchema },
  responses: {
    200: successResponse("Payment methods retrieved successfully", paymentMethodListResponseSchema),
  },
});

registry.registerPath({
  method: "get",
  path: "/payment-methods/{id}",
  tags: [TAG],
  summary: "Get one of my payment methods",
  request: { params: paymentMethodParamsSchema },
  responses: {
    200: successResponse("Payment method retrieved successfully", paymentMethodResponseSchema),
    404: NOT_FOUND,
  },
});

registry.registerPath({
  method: "patch",
  path: "/payment-methods/{id}",
  tags: [TAG],
  summary: "Rename a payment method or make it my primary one",
  description:
    "Only the label and the primary flag can change. Only a verified method can be primary, and there is one primary per person.",
  request: {
    params: paymentMethodParamsSchema,
    body: { content: { "application/json": { schema: updatePaymentMethodSchema } } },
  },
  responses: {
    200: successResponse("Payment method updated successfully", paymentMethodResponseSchema),
    404: NOT_FOUND,
    409: errorResponse(
      "Not verified yet",
      "Only a verified payment method can be your primary one",
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/payment-methods/{id}",
  tags: [TAG],
  summary: "Remove a payment method",
  description:
    "Soft delete: the record is kept for the audit trail. A payout method that uses it is removed too.",
  request: { params: paymentMethodParamsSchema },
  responses: {
    200: successResponse("Payment method removed successfully"),
    404: NOT_FOUND,
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/payment-methods",
  tags: [TAG],
  summary: "List everyone's payment methods",
  description: "Needs users: read. Numbers are masked here too.",
  request: { query: adminListPaymentMethodsQuerySchema },
  responses: {
    200: successResponse("Payment methods retrieved successfully", paymentMethodPageResponseSchema),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/payment-methods/{id}",
  tags: [TAG],
  summary: "Verify, reject or reset a payment method",
  description:
    "Needs users: update. `verified` makes it the person's primary if they have none; anything else clears its primary flag.",
  request: {
    params: paymentMethodParamsSchema,
    body: { content: { "application/json": { schema: adminUpdatePaymentMethodSchema } } },
  },
  responses: {
    200: successResponse("Payment method updated successfully", paymentMethodResponseSchema),
    404: NOT_FOUND,
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/payment-methods/{id}",
  tags: [TAG],
  summary: "Remove anyone's payment method",
  description: "Needs users: delete. Same soft delete as the owner's.",
  request: { params: paymentMethodParamsSchema },
  responses: {
    200: successResponse("Payment method removed successfully"),
    404: NOT_FOUND,
  },
});
