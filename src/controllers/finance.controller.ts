import type { Request, Response } from "express";
import {
  getFinanceOverview as buildOverview,
  getFinanceTransaction as findTransaction,
  listFinancePayouts as findPayouts,
  listFinanceTransactions as findTransactions,
  listFinanceWallets as findWallets,
  walletExists,
} from "../services/finance.service.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";
import type {
  ListFinancePayoutsQuery,
  ListFinanceTransactionsQuery,
  ListFinanceWalletsQuery,
  ListWalletTransactionsQuery,
} from "../schemas/finance.schema.js";

export async function getFinanceOverview(_req: Request, res: Response) {
  sendSuccess(res, "Finance overview retrieved successfully", await buildOverview());
}

export async function listFinanceTransactions(req: Request, res: Response) {
  const query = req.validated.query as ListFinanceTransactionsQuery;
  sendSuccess(res, "Transactions retrieved successfully", await findTransactions(query));
}

export async function getFinanceTransaction(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const transaction = await findTransaction(id);
  if (!transaction) {
    throw AppError.notFound(`Transaction not found: ${id}`);
  }
  sendSuccess(res, "Transaction retrieved successfully", transaction);
}

export async function listFinanceWallets(req: Request, res: Response) {
  const query = req.validated.query as ListFinanceWalletsQuery;
  sendSuccess(res, "Wallets retrieved successfully", await findWallets(query));
}

export async function listWalletTransactions(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const query = req.validated.query as ListWalletTransactionsQuery;
  if (!(await walletExists(userId))) {
    throw AppError.notFound(`Wallet not found for user: ${userId}`);
  }
  sendSuccess(
    res,
    "Transactions retrieved successfully",
    await findTransactions({ ...query, userId }),
  );
}

export async function listFinancePayouts(req: Request, res: Response) {
  const query = req.validated.query as ListFinancePayoutsQuery;
  sendSuccess(res, "Payouts retrieved successfully", await findPayouts(query));
}
