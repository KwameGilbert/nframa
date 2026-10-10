import { errorResponse, successResponse, registry } from "./registry.js";
import {
  financeOverviewResponseSchema,
  financePayoutListResponseSchema,
  financeTransactionListResponseSchema,
  financeTransactionParamsSchema,
  financeTransactionResponseSchema,
  financeWalletListResponseSchema,
  financeWalletParamsSchema,
  listFinancePayoutsQuerySchema,
  listFinanceTransactionsQuerySchema,
  listFinanceWalletsQuerySchema,
  listWalletTransactionsQuerySchema,
} from "../schemas/finance.schema.js";

const common = {
  tags: ["Finance"],
  security: [{ bearerAuth: [] }],
};

const unauthorized = errorResponse("Missing or invalid access token");
const forbidden = errorResponse("Missing permission: read on finance");

registry.registerPath({
  ...common,
  method: "get",
  path: "/admin/finance/overview",
  summary: "Get the finance overview",
  description:
    "The money picture in one call: GMV (successful trip and wait charges) and revenue (platform fees), ever and today; what the platform owes riders and drivers (wallet balances and drivers' held earnings); open payouts (pending and approved); frozen wallets; and top-ups in vs payouts out per day for the last 7 days. Days are UTC. Needs finance: read.",
  responses: {
    200: successResponse("Finance overview retrieved successfully", financeOverviewResponseSchema),
    401: unauthorized,
    403: forbidden,
  },
});

registry.registerPath({
  ...common,
  method: "get",
  path: "/admin/finance/transactions",
  summary: "List all transactions",
  description:
    "The whole ledger, every user's wallet plus the platform's fee rows, newest first, with credit and debit totals over the filtered set. Needs finance: read.",
  request: { query: listFinanceTransactionsQuerySchema },
  responses: {
    200: successResponse(
      "Transactions retrieved successfully",
      financeTransactionListResponseSchema,
    ),
    400: errorResponse("A filter is invalid, or from is after to"),
    401: unauthorized,
    403: forbidden,
  },
});

registry.registerPath({
  ...common,
  method: "get",
  path: "/admin/finance/transactions/{id}",
  summary: "Get a transaction",
  description: "One ledger row with its owner. Needs finance: read.",
  request: { params: financeTransactionParamsSchema },
  responses: {
    200: successResponse("Transaction retrieved successfully", financeTransactionResponseSchema),
    400: errorResponse("id is not a UUID"),
    401: unauthorized,
    403: forbidden,
    404: errorResponse("Transaction not found"),
  },
});

registry.registerPath({
  ...common,
  method: "get",
  path: "/admin/finance/wallets",
  summary: "List wallets",
  description:
    "Riders' and drivers' wallets, largest balance first, with lifetime top-ups and earnings and the latest activity. Totals cover the filtered set. Needs finance: read.",
  request: { query: listFinanceWalletsQuerySchema },
  responses: {
    200: successResponse("Wallets retrieved successfully", financeWalletListResponseSchema),
    400: errorResponse("A filter is invalid"),
    401: unauthorized,
    403: forbidden,
  },
});

registry.registerPath({
  ...common,
  method: "get",
  path: "/admin/finance/wallets/{userId}/transactions",
  summary: "List a wallet's transactions",
  description:
    "The same list as GET /admin/finance/transactions, for one user's wallet. Needs finance: read.",
  request: { params: financeWalletParamsSchema, query: listWalletTransactionsQuerySchema },
  responses: {
    200: successResponse(
      "Transactions retrieved successfully",
      financeTransactionListResponseSchema,
    ),
    400: errorResponse("userId is not a UUID, a filter is invalid, or from is after to"),
    401: unauthorized,
    403: forbidden,
    404: errorResponse("Wallet not found for user"),
  },
});

registry.registerPath({
  ...common,
  method: "get",
  path: "/admin/finance/payouts",
  summary: "List payouts",
  description:
    "Every driver's payouts, oldest first, with the driver and where the money goes; status=pending is the approval queue. Needs finance: read.",
  request: { query: listFinancePayoutsQuerySchema },
  responses: {
    200: successResponse("Payouts retrieved successfully", financePayoutListResponseSchema),
    400: errorResponse("A filter is invalid, or from is after to"),
    401: unauthorized,
    403: forbidden,
  },
});
