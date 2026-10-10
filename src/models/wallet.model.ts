import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { toTransaction, type Transaction } from "./transaction.model.js";
import { roundMoney } from "../utils/money.js";
import { AppError } from "../utils/AppError.js";
import { transition } from "../utils/transition.js";
import { settingModel } from "./setting.model.js";
import type { TransactionDirection, TransactionType } from "../schemas/wallet.schema.js";
import { createLogger } from "../config/logger.js";

export interface Wallet {
  userId: string;
  balance: number;
  heldAmount: number;
  // Driver credits (earnings, tips) still in their hold period: not withdrawable until released into balance.
  pendingBalance: number;
  // An admin can freeze a wallet: money still comes in and held credits still release, nothing goes out.
  status: "active" | "frozen";
  frozenAt: Date | null;
  frozenBy: string | null;
  frozenReason: string | null;
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

// What a move writes to the ledger: a new row, or the settlement of one of the user's pending rows.
export type MoveRow =
  | (Omit<LedgerEntry, "userId"> & {
      status: "pending" | "success";
      availableAt?: Date;
      actorId?: string;
      note?: string;
    })
  | { id: string; status: "success" | "failed" };

export interface Move {
  userId: string;
  // Signed amounts added to the wallet's columns.
  delta?: { balance?: number; pendingBalance?: number };
  // Set on outflows: a frozen wallet refuses them with 423.
  requireActive?: boolean;
  row: MoveRow;
}

// Creates the wallet if needed, then locks its row until the transaction ends, so concurrent balance
// changes queue up instead of overwriting each other.
async function lockWallet(trx: Knex.Transaction, userId: string): Promise<Wallet> {
  await trx("wallets").insert({ userId }).onConflict("userId").ignore();
  return trx("wallets").where({ userId }).forUpdate().first();
}

// A zero or negative amount would silently move the wrong money: that's a caller bug.
function positiveMoney(amount: number): number {
  const rounded = roundMoney(amount);
  if (!(rounded > 0)) throw new Error(`Money amounts must be positive, got ${amount}`);
  return rounded;
}

const logger = createLogger("app");
const RELEASE_BATCH = 500;

// When a driver credit written at `from` (an earning or a tip) is released into the driver's balance.
export async function heldUntil(from: Date = new Date()): Promise<Date> {
  const hours = await settingModel.getValue("finance.earningsHoldHours");
  return new Date(from.getTime() + hours * 3_600_000);
}

// The only code that changes a wallet balance or hold. Every balance change locks the wallet and writes its ledger row
// (transactions) in the same database transaction, so the balance always equals the ledger's sum.
class WalletModel extends BaseModel<Wallet> {
  protected readonly tableName = "wallets";
  protected readonly primaryKey = "userId";

  protected sanitize(row: Wallet): Wallet {
    return {
      ...row,
      balance: Number(row.balance),
      heldAmount: Number(row.heldAmount),
      pendingBalance: Number(row.pendingBalance),
    };
  }

  // Every wallet balance change goes through here. Locks the wallet, refuses an outflow from a frozen wallet (423),
  // applies the deltas, then writes or settles the ledger row with the new balance. The deltas apply in one UPDATE
  // that only matches while pendingBalance stays >= 0 and a debit leaves spendable (balance - heldAmount) >= 0;
  // otherwise 409. Arithmetic happens in SQL on numeric, so there's no float rounding drift.
  async move(
    trx: Knex.Transaction,
    { userId, delta = {}, requireActive = false, row }: Move,
  ): Promise<{ wallet: Wallet; transaction: Transaction }> {
    const balance = roundMoney(delta.balance ?? 0);
    const pendingBalance = roundMoney(delta.pendingBalance ?? 0);
    const locked = await lockWallet(trx, userId);
    if (requireActive && locked.status === "frozen") throw AppError.locked("This wallet is frozen");

    const [updated] = await trx("wallets")
      .where({ userId })
      .andWhereRaw(`"pendingBalance" + ? >= 0`, [pendingBalance])
      .andWhereRaw(`(?::numeric >= 0 OR "balance" + ? >= "heldAmount")`, [balance, balance])
      .update({
        balance: trx.raw(`"balance" + ?`, [balance]),
        pendingBalance: trx.raw(`"pendingBalance" + ?`, [pendingBalance]),
        updatedAt: new Date(),
      })
      .returning("*");
    if (!updated) throw AppError.conflict("Insufficient wallet balance");
    const wallet = this.sanitize(updated);

    if ("id" in row) {
      const settled = await transition<Transaction>(
        trx,
        "transactions",
        row.id,
        ["pending"],
        row.status,
        {
          balanceAfter: wallet.balance,
        },
      );
      if (settled.userId !== userId) throw new Error(`Transaction ${row.id} isn't ${userId}'s`);
      return { wallet, transaction: toTransaction(settled) };
    }

    const { metadata, ...fields } = row;
    const [inserted] = await trx("transactions")
      .insert({
        ...fields,
        userId,
        amount: positiveMoney(row.amount),
        balanceAfter: wallet.balance,
        metadata: metadata ? JSON.stringify(metadata) : null,
      })
      .returning("*");
    return { wallet, transaction: toTransaction(inserted) };
  }

  // A user who has never had money moved has no row yet: their wallet is empty. nextReleaseAt is when the
  // earliest held credit moves into balance (null when nothing is held).
  async getWallet(userId: string) {
    const [wallet, next] = await Promise.all([
      this.findById(userId),
      db("transactions")
        .where({ userId, status: "pending", direction: "credit" })
        .whereNotNull("availableAt")
        .min<{ nextReleaseAt: Date | null }>("availableAt as nextReleaseAt")
        .first(),
    ]);
    const balance = wallet?.balance ?? 0;
    const heldAmount = wallet?.heldAmount ?? 0;
    return {
      balance,
      heldAmount,
      availableBalance: roundMoney(balance - heldAmount),
      pendingBalance: wallet?.pendingBalance ?? 0,
      status: wallet?.status ?? "active",
      nextReleaseAt: next?.nextReleaseAt ?? null,
    };
  }

  async getAvailableBalance(userId: string) {
    return (await this.getWallet(userId)).availableBalance;
  }

  // What the user can spend right now (balance - heldAmount), read under the wallet lock the caller's trx holds.
  async spendableIn(trx: Knex.Transaction, userId: string): Promise<number> {
    const wallet = await lockWallet(trx, userId);
    return Math.max(0, roundMoney(Number(wallet.balance) - Number(wallet.heldAmount)));
  }

  // Credits or debits a wallet and records it as a successful transaction, in its own database transaction or
  // in trx. A debit never takes the wallet below what the user can spend (balance - heldAmount): it's refused with 409.
  record(entry: LedgerEntry, trx?: Knex.Transaction): Promise<Transaction> {
    return trx ? this.recordIn(trx, entry) : db.transaction((t) => this.recordIn(t, entry));
  }

  async recordIn(trx: Knex.Transaction, { userId, ...entry }: LedgerEntry): Promise<Transaction> {
    const amount = positiveMoney(entry.amount);
    const { transaction } = await this.move(trx, {
      userId,
      delta: { balance: entry.direction === "credit" ? amount : -amount },
      row: { ...entry, amount, status: "success" },
    });
    return transaction;
  }

  // Trip money: hold on accept, then capture at boarding or release on cancel/decline/no-show. Each takes the
  // caller's trx so the trip's own update commits with it, and the rider's heldAmount always equals the sum of
  // heldAmount on their accepted trips.
  // Lock order, everywhere trip money moves: the commute row, then the trip row, then the rider's wallet, then
  // the driver's wallet. Taking locks in one fixed order means two transactions can never deadlock.

  // Reserves amount out of what the rider can spend. The check and the reservation are one UPDATE, so
  // simultaneous holds can't reserve the same money twice. No wallet yet means nothing to hold. A frozen wallet
  // can't take on new trips (423).
  async hold(trx: Knex.Transaction, userId: string, amount: number): Promise<void> {
    const rounded = positiveMoney(amount);
    const wallet: Wallet | undefined = await trx("wallets").where({ userId }).forUpdate().first();
    if (wallet?.status === "frozen") throw AppError.locked("This wallet is frozen");
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

  // Turns a trip's hold into its charge: releases amount and debits the same amount as the tripCharge.
  async capture(
    trx: Knex.Transaction,
    { userId, tripId, amount }: { userId: string; tripId: string; amount: number },
  ): Promise<Transaction> {
    await this.release(trx, userId, amount);
    return this.recordIn(trx, { userId, tripId, type: "tripCharge", direction: "debit", amount });
  }

  // A rider's tip to a driver for a trip, in the caller's trx. The rider's debit settles at once and never takes them
  // below what they can spend (409); a frozen rider can't tip (423). The driver's credit is held like an earning:
  // pending until heldUntil, counted in their pendingBalance. The rider's wallet is locked first, then the driver's.
  async transferTip(
    trx: Knex.Transaction,
    {
      fromUserId,
      toUserId,
      tripId,
      amount,
    }: { fromUserId: string; toUserId: string; tripId: string; amount: number },
  ): Promise<void> {
    const rounded = positiveMoney(amount);
    await this.move(trx, {
      userId: fromUserId,
      delta: { balance: -rounded },
      requireActive: true,
      row: { tripId, type: "tip", direction: "debit", amount: rounded, status: "success" },
    });
    await this.move(trx, {
      userId: toUserId,
      delta: { pendingBalance: rounded },
      row: {
        tripId,
        type: "tip",
        direction: "credit",
        amount: rounded,
        status: "pending",
        availableAt: await heldUntil(),
      },
    });
  }

  // The platform's own income for a trip (its platformFee row). The platform has no wallet, so this is a plain
  // insert: account platform, no user, no balanceAfter. One per trip (transactions_one_per_trip_type).
  async recordPlatformIn(
    trx: Knex.Transaction,
    { tripId, type, amount }: { tripId: string; type: "platformFee"; amount: number },
  ): Promise<Transaction> {
    const [inserted] = await trx("transactions")
      .insert({
        account: "platform",
        userId: null,
        tripId,
        type,
        direction: "credit",
        amount: positiveMoney(amount),
        status: "success",
      })
      .returning("*");
    return toTransaction(inserted);
  }

  // Moves every held driver credit (earning or tip) whose availableAt has passed into balance: each in its own
  // database transaction, so one bad row can't hold the rest back. Runs on frozen wallets too: a release isn't an
  // outflow. A row someone else released first fails transition with 409 and is skipped; a row that fails
  // any other way is logged and skipped. Returns how many released.
  async releaseDueEarnings(userId?: string): Promise<number> {
    const now = new Date();
    let released = 0;
    // Walks (availableAt, id) forward, so a skipped row is never picked up again in this run.
    let after: { availableAt: Date; id: string } | undefined;
    for (;;) {
      const due: Pick<Transaction, "id" | "userId" | "amount" | "availableAt">[] = await db(
        "transactions",
      )
        .where({ status: "pending", direction: "credit" })
        .whereNotNull("availableAt")
        .where("availableAt", "<=", now)
        .modify((q) => {
          if (userId) q.where({ userId });
          if (after) q.whereRaw(`("availableAt", "id") > (?, ?)`, [after.availableAt, after.id]);
        })
        .orderBy([{ column: "availableAt" }, { column: "id" }])
        .limit(RELEASE_BATCH)
        .select("id", "userId", "amount", "availableAt");

      for (const row of due) {
        after = { availableAt: row.availableAt as Date, id: row.id };
        try {
          await db.transaction((trx) =>
            this.move(trx, {
              userId: row.userId as string,
              delta: { balance: Number(row.amount), pendingBalance: -Number(row.amount) },
              row: { id: row.id, status: "success" },
            }),
          );
          released++;
        } catch (err) {
          // Released by someone else first: nothing to do. Anything else is logged and the sweep moves on.
          if (!(err instanceof AppError && err.statusCode === 409)) {
            logger.error({ err, transactionId: row.id }, "Failed to release a held driver credit");
          }
        }
      }
      if (due.length < RELEASE_BATCH) return released;
    }
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

      const { transaction } = await this.move(trx, {
        userId: pending.userId as string,
        delta: { balance: Number(pending.amount) },
        row: { id: pending.id, status: "success" },
      });
      return { transaction, credited: true };
    });
  }
}

export const walletModel = new WalletModel();
