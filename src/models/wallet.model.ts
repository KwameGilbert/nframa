import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { toTransaction, type Transaction } from "./transaction.model.js";
import { roundMoney } from "../utils/money.js";
import { AppError } from "../utils/AppError.js";
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

// A zero or negative hold/release would silently move other trips' held money: that's a caller bug.
function positiveMoney(amount: number): number {
  const rounded = roundMoney(amount);
  if (!(rounded > 0)) throw new Error(`Trip money amounts must be positive, got ${amount}`);
  return rounded;
}

// The only code that changes a wallet balance or hold. Every balance change locks the wallet and writes its ledger row
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

  // Credits or debits a wallet and records it as a successful transaction, in its own database transaction or
  // in trx. A debit may take the balance below zero on purpose (a wait charge after boarding); callers that must
  // not overdraw check getAvailableBalance first, or hold the money.
  record(entry: LedgerEntry, trx?: Knex.Transaction): Promise<Transaction> {
    return trx ? this.recordIn(trx, entry) : db.transaction((t) => this.recordIn(t, entry));
  }

  async recordIn(trx: Knex.Transaction, { metadata, ...entry }: LedgerEntry): Promise<Transaction> {
    const amount = roundMoney(entry.amount);
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
  }

  // Trip money: hold on accept, then capture at boarding or release on cancel/decline/no-show. Each takes the
  // caller's trx so the trip's own update commits with it, and the rider's heldAmount always equals the sum of
  // heldAmount on their accepted trips.
  // Lock order, everywhere trip money moves: the commute row, then the trip row, then the rider's wallet, then
  // the driver's wallet. Taking locks in one fixed order means two transactions can never deadlock.

  // Reserves amount out of what the rider can spend. The check and the reservation are one UPDATE, so
  // simultaneous holds can't reserve the same money twice. No wallet yet means nothing to hold.
  async hold(trx: Knex.Transaction, userId: string, amount: number): Promise<void> {
    const rounded = positiveMoney(amount);
    await trx("wallets").where({ userId }).forUpdate().first();
    const updated = await trx("wallets")
      .where({ userId })
      .andWhereRaw(`"balance" - "heldAmount" >= ?`, [rounded])
      .update({ heldAmount: trx.raw(`"heldAmount" + ?`, [rounded]), updatedAt: new Date() });
    if (updated === 0) throw AppError.conflict("Insufficient wallet balance");
  }

  // Gives held money back to the rider's available balance. No ledger row: the balance itself doesn't change.
  // Releasing more than is held breaks wallets_held_amount_check and rolls the caller back: a double release is a
  // bug to surface, not to paper over.
  async release(trx: Knex.Transaction, userId: string, amount: number): Promise<void> {
    await trx("wallets")
      .where({ userId })
      .update({
        heldAmount: trx.raw(`"heldAmount" - ?`, [positiveMoney(amount)]),
        updatedAt: new Date(),
      });
  }

  // Turns a trip's hold into its charge: releases amount and debits the same amount as the trip_charge.
  async capture(
    trx: Knex.Transaction,
    { userId, tripId, amount }: { userId: string; tripId: string; amount: number },
  ): Promise<Transaction> {
    await this.release(trx, userId, amount);
    return this.recordIn(trx, { userId, tripId, type: "trip_charge", direction: "debit", amount });
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
