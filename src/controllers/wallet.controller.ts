import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { transactionModel, type Transaction } from "../models/transaction.model.js";
import { walletModel } from "../models/wallet.model.js";
import { settingModel } from "../models/setting.model.js";
import { userModel } from "../models/user.model.js";
import { assertPaymentsConfigured, initializeTransaction } from "../services/paystack.service.js";
import { confirmTopUp, type TopUpOutcome } from "../services/wallet.service.js";
import { logActivity } from "../services/activityLog.service.js";
import { notifyWallet } from "../services/notificationEvents.service.js";
import { AppError } from "../utils/AppError.js";
import { CURRENCY, toPesewas } from "../utils/money.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { ListTransactionsQuery, PaystackEvent, TopUpInput } from "../schemas/wallet.schema.js";

const WALLET_ACTIVITY = { module: "wallets", targetType: "transaction" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }
  return req.auth.id;
}

// Records what confirming a top-up did, if anything. actorId is the wallet owner: the webhook has no
// signed-in user, but the money is theirs. A webhook's payment details (card, customer) are left out.
function logOutcome(req: Request, before: Transaction, outcome: TopUpOutcome) {
  const { transaction: after, credited, failedNow } = outcome;
  const activity = {
    ...WALLET_ACTIVITY,
    targetId: after.id,
    actorId: after.userId,
    before,
    after,
    redact: ["data"],
  };
  if (credited) {
    logActivity(req, {
      ...activity,
      action: "wallet.topup_settled",
      description: `Wallet topped up with ${after.currency} ${after.amount.toFixed(2)}`,
    });
    void notifyWallet(after.userId as string, "topUp", {
      id: after.id,
      amount: after.amount,
      currency: after.currency,
    });
  } else if (failedNow) {
    logActivity(req, {
      ...activity,
      action: "wallet.topup_failed",
      description: `A ${after.currency} ${after.amount.toFixed(2)} wallet top-up failed`,
      error: failedNow,
    });
    void notifyWallet(after.userId as string, "topUpFailed", {
      id: after.id,
      amount: after.amount,
      currency: after.currency,
    });
  }
}

// Paystack requires an email; phone-only accounts get a stand-in on a domain that never receives mail.
async function payerEmail(userId: string) {
  const user = await userModel.findById(userId);
  return user?.email ?? `${userId}@${process.env.PAYSTACK_FALLBACK_EMAIL_DOMAIN || "example.com"}`;
}

export async function getWallet(req: Request, res: Response) {
  const wallet = await walletModel.getWallet(callerId(req));
  sendSuccess(res, "Wallet retrieved successfully", { ...wallet, currency: CURRENCY });
}

export async function listTransactions(req: Request, res: Response) {
  const query = req.validated.query as ListTransactionsQuery;
  const { items, total } = await transactionModel.listForUser(callerId(req), query);

  sendSuccess(res, "Transactions retrieved successfully", {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems: total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
}

export async function startTopUp(req: Request, res: Response) {
  const userId = callerId(req);
  const { amount } = req.validated.body as TopUpInput;

  assertPaymentsConfigured();
  const limits = await settingModel.getValues(["wallet.minTopUp", "wallet.maxTopUp"]);
  if (limits["wallet.minTopUp"] > limits["wallet.maxTopUp"]) {
    throw AppError.serviceUnavailable("Top-up limits are misconfigured");
  }
  if (amount < limits["wallet.minTopUp"]) {
    throw AppError.badRequest(`Amount must be at least ${CURRENCY} ${limits["wallet.minTopUp"]}`);
  }
  if (amount > limits["wallet.maxTopUp"]) {
    throw AppError.badRequest(`Amount must be at most ${CURRENCY} ${limits["wallet.maxTopUp"]}`);
  }

  const reference = `NF-${randomBytes(12).toString("hex")}`;
  const topUp = await transactionModel.createPendingTopUp({
    userId,
    amount,
    provider: "paystack",
    providerReference: reference,
  });

  let payment;
  try {
    payment = await initializeTransaction({
      email: await payerEmail(userId),
      amountPesewas: toPesewas(amount),
      reference,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || undefined,
      metadata: { userId, transactionId: topUp.id },
    });
  } catch (err) {
    const reason = "Paystack couldn't start the payment";
    const failed = await transactionModel.markFailed(topUp.id, reason);
    if (failed) logOutcome(req, topUp, { transaction: failed, credited: false, failedNow: reason });
    throw Object.assign(AppError.badGateway("Couldn't start the payment, try again"), {
      cause: err,
    });
  }

  sendCreated(res, "Top-up started successfully", {
    reference,
    authorizationUrl: payment.authorizationUrl,
    accessCode: payment.accessCode,
    amount: topUp.amount,
    currency: topUp.currency,
  });

  logActivity(req, {
    ...WALLET_ACTIVITY,
    action: "wallet.topup_initiated",
    description: `Started a ${topUp.currency} ${topUp.amount.toFixed(2)} wallet top-up`,
    targetId: topUp.id,
    after: topUp,
  });
}

// For the app to call after Paystack's redirect, in case the webhook hasn't arrived yet.
export async function verifyTopUp(req: Request, res: Response) {
  const { reference } = req.validated.params as { reference: string };

  const topUp = await transactionModel.findByReference(reference);
  if (!topUp || topUp.type !== "topup" || topUp.userId !== callerId(req)) {
    throw AppError.notFound(`Top-up not found: ${reference}`);
  }

  const outcome = await confirmTopUp(topUp);

  sendSuccess(res, "Top-up retrieved successfully", outcome.transaction);

  logOutcome(req, topUp, outcome);
}

// Public, but only reached with a valid Paystack signature (verifyPaystackSignature). Answers 200 to every
// signed event it has handled, even one it ignores, or Paystack keeps retrying it.
export async function handlePaystackWebhook(req: Request, res: Response) {
  const { event, data } = req.validated.body as PaystackEvent;

  const topUp =
    event === "charge.success" && data.reference
      ? await transactionModel.findByReference(data.reference)
      : undefined;

  if (topUp?.type === "topup") {
    const outcome = await confirmTopUp(topUp);
    sendSuccess(res, "Webhook handled");
    logOutcome(req, topUp, outcome);
    return;
  }

  sendSuccess(res, "Webhook ignored");
}
