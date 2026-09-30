import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { toTransaction, type Transaction } from "./transaction.model.js";
import { roundMoney } from "../utils/money.js";
import type { TransactionDirection, TransactionType } from "../schemas/wallet.schema.js";

export interface Wallet {
  userId: string;
  balance: number;
  heldAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  userId: string;
  type: TransactionType;
  direction: TransactionDirection;
  amount: number;
  tripId?: string;
  provider?: string;
  providerReference?: string;
  metadata?: Record<string, unknown>;
}

// Creates the wallet if needed, then locks its row until the transaction ends, so concurrent balance
// changes queue up instead of overwriting each other.
async function lockWallet(trx: Knex.Transaction, userId: string) {
  await trx("wallets").insert({ userId }).onConflict("userId").ignore();
  await trx("wallets").where({ userId }).forUpdate().first();
}

// Returns the new balance. Arithmetic happens in SQL on numeric, so there's no float rounding drift.
async function applyToBalance(
  trx: Knex.Transaction,
  userId: string,
  direction: TransactionDirection,
  amount: number,
): Promise<number> {
  const [row] = await trx("wallets")
    .where({ userId })
    .update({
      balance: trx.raw(`"balance" ${direction === "credit" ? "+" : "-"} ?`, [amount]),
      updatedAt: new Date(),
    })
    .returning("balance");
  return Number(row.balance);
}

// The only code that changes a wallet balance. Every change locks the wallet and writes its ledger row
// (transactions) in the same database transaction, so the balance always equals the ledger's sum.
class WalletModel extends BaseModel<Wallet> {
  protected readonly tableName = "wallets";
  protected readonly primaryKey = "userId";

  protected sanitize(row: Wallet): Wallet {
    return { ...row, balance: Number(row.balance), heldAmount: Number(row.heldAmount) };
  }

  // A user who has never had money moved has no row yet: their wallet is empty.
  async getWallet(userId: string) {
    const wallet = await this.findById(userId);
    const balance = wallet?.balance ?? 0;
    const heldAmount = wallet?.heldAmount ?? 0;
    return { balance, heldAmount, availableBalance: roundMoney(balance - heldAmount) };
  }

  async getAvailableBalance(userId: string) {
    return (await this.getWallet(userId)).availableBalance;
  }

  // Credits or debits a wallet and records it as a successful transaction. A debit may take the balance
  // below zero on purpose (a wait charge after boarding); callers that must not overdraw check
  // getAvailableBalance first.
  async record({ metadata, ...entry }: LedgerEntry): Promise<Transaction> {
    const amount = roundMoney(entry.amount);
    return db.transaction(async (trx) => {
      await lockWallet(trx, entry.userId);
      const balanceAfter = await applyToBalance(trx, entry.userId, entry.direction, amount);
      const [row] = await trx("transactions")
        .insert({
          ...entry,
          amount,
          status: "success",
          balanceAfter,
          metadata: metadata ? JSON.stringify(metadata) : null,
        })
        .returning("*");
      return toTransaction(row);
    });
  }

  // Credits a pending top-up once its payment is confirmed. Idempotent: the transaction row is locked first,
  // so of two simultaneous calls for the same reference one credits and the other sees it already settled.
  // A transaction that isn't pending (already credited, or failed) is returned unchanged.
  async settleTopUp(
    providerReference: string,
  ): Promise<{ transaction: Transaction; credited: boolean } | undefined> {
    return db.transaction(async (trx) => {
      const pending: Transaction | undefined = await trx("transactions")
        .where({ providerReference, type: "topup" })
        .forUpdate()
        .first();
      if (!pending) return undefined;
      if (pending.status !== "pending") {
        return { transaction: toTransaction(pending), credited: false };
      }

      await lockWallet(trx, pending.userId);
      const balanceAfter = await applyToBalance(
        trx,
        pending.userId,
        "credit",
        Number(pending.amount),
      );
      const [row] = await trx("transactions")
        .where({ id: pending.id })
        .update({ status: "success", balanceAfter, updatedAt: new Date() })
        .returning("*");
      return { transaction: toTransaction(row), credited: true };
    });
  }
}

export const walletModel = new WalletModel();
