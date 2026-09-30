import { z } from "zod";
import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  listTransactionsQuerySchema,
  paystackEventSchema,
  topUpReferenceParamsSchema,
  topUpResponseSchema,
  topUpSchema,
  transactionListResponseSchema,
  transactionResponseSchema,
  walletResponseSchema,
} from "../schemas/wallet.schema.js";

const unauthorized = errorResponse("Missing or invalid access token");

registry.registerPath({
  method: "get",
  path: "/wallet",
  tags: ["Wallet"],
  summary: "Get my wallet balance (any signed-in user)",
  description:
    "The caller's own wallet. heldAmount is money reserved for accepted trips that haven't been charged yet; availableBalance (balance - heldAmount) is what can be spent. An account that has never had money moved has a zero wallet.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Wallet retrieved successfully", walletResponseSchema),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/wallet/transactions",
  tags: ["Wallet"],
  summary: "List my wallet transactions (any signed-in user)",
  description:
    "The caller's own transactions, newest first, including pending and failed top-ups. Successful ones carry balanceAfter.",
  security: [{ bearerAuth: [] }],
  request: { query: listTransactionsQuerySchema },
  responses: {
    200: successResponse("Transactions retrieved successfully", transactionListResponseSchema),
    400: errorResponse("Invalid page, limit, type or status"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/wallet/topup",
  tags: ["Wallet"],
  summary: "Start a wallet top-up through Paystack (any signed-in user)",
  description:
    "Records a pending top-up and returns the Paystack checkout to send the rider to (authorizationUrl, or accessCode for Paystack's mobile SDKs). The wallet is credited once the payment is confirmed — by Paystack's webhook, or by POST /wallet/topup/{reference}/verify after the redirect back. The amount must be within the wallet.minTopUp and wallet.maxTopUp settings.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: topUpSchema } } } },
  responses: {
    201: successResponse("Top-up started successfully", topUpResponseSchema),
    400: errorResponse("Invalid amount, or outside the top-up limits"),
    401: unauthorized,
    429: rateLimitedResponse,
    502: errorResponse("Paystack couldn't start the payment (the top-up is recorded as failed)"),
    503: errorResponse("Payments are not configured"),
  },
});

registry.registerPath({
  method: "post",
  path: "/wallet/topup/{reference}/verify",
  tags: ["Wallet"],
  summary: "Confirm one of my top-ups with Paystack (any signed-in user)",
  description:
    "For the app to call when the rider returns from Paystack, in case the webhook is late. If the top-up is still pending, asks Paystack and credits the wallet when the payment succeeded for the recorded amount and currency (a mismatch, or a reversal, marks it failed). A declined or abandoned payment leaves it pending, since the rider can retry on the same checkout. Safe to call repeatedly: a top-up is credited once. Returns the transaction, which may still be pending. Top-up starts and verifies share a per-account rate limit.",
  security: [{ bearerAuth: [] }],
  request: { params: topUpReferenceParamsSchema },
  responses: {
    200: successResponse("Top-up retrieved successfully", transactionResponseSchema),
    401: unauthorized,
    404: errorResponse("No top-up of yours has this reference"),
    429: rateLimitedResponse,
    502: errorResponse("Couldn't reach Paystack to check the payment"),
    503: errorResponse("Payments are not configured"),
  },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/paystack",
  tags: ["Wallet"],
  summary: "Paystack webhook (called by Paystack, not by apps)",
  description:
    "Paystack posts payment events here. No access token: the x-paystack-signature header (HMAC-SHA512 of the raw body with the Paystack secret key) must match, or the request is refused with no effect. On charge.success for a pending top-up, the payment is re-checked with Paystack (the event's own amount is never trusted) and the wallet credited once, however many times the event is delivered. Every correctly signed event gets 200, including ones for unknown references or other event types, so Paystack stops retrying.",
  request: {
    headers: z.object({
      "x-paystack-signature": z.string().meta({
        description: "Hex HMAC-SHA512 of the raw request body, keyed with the secret key",
      }),
    }),
    body: { content: { "application/json": { schema: paystackEventSchema } } },
  },
  responses: {
    200: successResponse("Webhook handled"),
    400: errorResponse("Signed, but not a Paystack event body"),
    401: errorResponse("Invalid webhook signature"),
    502: errorResponse("Couldn't reach Paystack to check the payment (Paystack will retry)"),
    503: errorResponse("Payments are not configured"),
  },
});
