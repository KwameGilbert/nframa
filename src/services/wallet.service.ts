import { transactionModel, type Transaction } from "../models/transaction.model.js";
import { walletModel } from "../models/wallet.model.js";
import { verifyTransaction } from "./paystack.service.js";
import { toPesewas } from "../utils/money.js";
import { AppError } from "../utils/AppError.js";
import { createLogger } from "../config/logger.js";
import { sendTopUpEmail } from "./email.service.js";

const logger = createLogger("app");

export interface TopUpOutcome {
  transaction: Transaction;
  credited: boolean;
  // Set when this call marked the top-up failed, with why; the caller records it in the audit trail.
  failedNow?: string;
}

// Asks Paystack how a pending top-up went and settles it. Never trusts a webhook body's amount: the credit
// happens only when Paystack itself reports success for exactly the amount and currency recorded. Safe to
// call any number of times, concurrently too — settleTopUp credits at most once.
// Only a reversal or a mismatch fails a top-up. Paystack's "failed" and "abandoned" aren't final: the payer can
// retry on the same reference and succeed, so the top-up stays pending.
export async function confirmTopUp(topUp: Transaction): Promise<TopUpOutcome> {
  const unchanged = { transaction: topUp, credited: false };
  if (topUp.status !== "pending" || !topUp.providerReference) return unchanged;

  const payment = await verifyTransaction(topUp.providerReference).catch((err: unknown) => {
    if (err instanceof AppError) throw err;
    throw Object.assign(
      AppError.badGateway("Couldn't check the payment with Paystack, try again"),
      { cause: err },
    );
  });

  if (payment.status === "reversed") {
    return failed(topUp, "Paystack reported the payment as reversed");
  }
  if (payment.status !== "success") return unchanged;

  const expected = toPesewas(topUp.amount);
  if (payment.amountPesewas !== expected || payment.currency !== topUp.currency) {
    const reason = `Paystack reported ${payment.amountPesewas} pesewas ${payment.currency}, expected ${expected} ${topUp.currency}`;
    // Money may have been taken that the wallet doesn't get: needs a person to look at it.
    logger.warn(
      { transactionId: topUp.id, userId: topUp.userId, reason },
      "Top-up amount mismatch",
    );
    return failed(topUp, reason);
  }

  const settled = await walletModel.settleTopUp(topUp.providerReference);
  // Only the call that credited it sends the receipt, so repeated or simultaneous deliveries send one.
  if (settled?.credited) {
    void sendTopUpEmail(topUp.userId, settled.transaction.amount, settled.transaction.currency);
  }
  return settled ?? unchanged;
}

async function failed(topUp: Transaction, reason: string): Promise<TopUpOutcome> {
  const marked = await transactionModel.markFailed(topUp.id, reason);
  if (marked) return { transaction: marked, credited: false, failedNow: reason };
  // Settled or failed meanwhile by another call: report what it is now.
  return { transaction: (await transactionModel.findById(topUp.id)) ?? topUp, credited: false };
}
