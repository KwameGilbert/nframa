import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  financeTransactionParamsSchema,
  financeWalletParamsSchema,
  listFinancePayoutsQuerySchema,
  listFinanceTransactionsQuerySchema,
  listFinanceWalletsQuerySchema,
  listWalletTransactionsQuerySchema,
} from "../schemas/finance.schema.js";
import {
  getFinanceOverview,
  getFinanceTransaction,
  listFinancePayouts,
  listFinanceTransactions,
  listFinanceWallets,
  listWalletTransactions,
} from "../controllers/finance.controller.js";

export const financeRouter = Router();

const canRead = [authenticate, requirePermission("finance", "read")];

// Read-only money views across every wallet: totals, the ledger, balances and the payout queue.
financeRouter.get("/admin/finance/overview", ...canRead, getFinanceOverview);

financeRouter.get(
  "/admin/finance/transactions",
  ...canRead,
  validate({ query: listFinanceTransactionsQuerySchema }),
  listFinanceTransactions,
);

financeRouter.get(
  "/admin/finance/transactions/:id",
  ...canRead,
  validate({ params: financeTransactionParamsSchema }),
  getFinanceTransaction,
);

financeRouter.get(
  "/admin/finance/wallets",
  ...canRead,
  validate({ query: listFinanceWalletsQuerySchema }),
  listFinanceWallets,
);

financeRouter.get(
  "/admin/finance/wallets/:userId/transactions",
  ...canRead,
  validate({ params: financeWalletParamsSchema, query: listWalletTransactionsQuerySchema }),
  listWalletTransactions,
);

financeRouter.get(
  "/admin/finance/payouts",
  ...canRead,
  validate({ query: listFinancePayoutsQuerySchema }),
  listFinancePayouts,
);
