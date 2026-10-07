import { randomUUID } from "node:crypto";
import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";
import { transition } from "../utils/transition.js";
import { BaseModel } from "./BaseModel.js";
import { walletModel } from "./wallet.model.js";
import type { ListPayoutsQuery } from "../schemas/payout.schema.js";

export type PayoutStatus = "pending" | "approved" | "paid" | "rejected" | "failed" | "cancelled";

export interface Payout {
  id: string;
  driverUserId: string;
  payoutMethodId: string | null;
  amount: number;
  status: PayoutStatus;
  transactionId: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

class PayoutModel extends BaseModel<Payout> {
  protected readonly tableName = "payouts";

  protected sanitize(row: Payout): Payout {
    return { ...row, amount: Number(row.amount) };
  }

  // Takes the amount out of the driver's balance at once (a pending payout debit), so it can't be spent or
  // requested twice while an admin pays it. Due held credits are released first, so they count towards it.
  async request(driverUserId: string, payoutMethodId: string, amount: number): Promise<Payout> {
    await walletModel.releaseDueEarnings(driverUserId);
    try {
      return await db.transaction(async (trx) => {
        const { transaction } = await walletModel.move(trx, {
          userId: driverUserId,
          delta: { balance: -amount },
          requireActive: true,
          row: {
            type: "payout",
            direction: "debit",
            amount,
            status: "pending",
            metadata: { payoutMethodId },
          },
        });
        const [payout] = await trx("payouts")
          .insert({
            id: randomUUID(),
            driverUserId,
            payoutMethodId,
            amount,
            transactionId: transaction.id,
          })
          .returning("*");
        return this.sanitize(payout);
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw AppError.conflict("You already have a payout waiting to be paid");
      }
      // The payout method was deleted while the payout was being requested.
      if ((err as { code?: string }).code === "23503") {
        throw AppError.conflict("This payout method no longer exists");
      }
      throw err;
    }
  }

  // Only a payout no admin has acted on yet can be cancelled: its debit fails and the amount goes back to the
  // balance in the same move. The payout row is locked before the wallet, the order every payout change uses.
  async cancel(id: string, driverUserId: string): Promise<Payout | undefined> {
    return db.transaction(async (trx) => {
      const locked = await trx("payouts").where({ id, driverUserId }).forUpdate().first();
      if (!locked) return undefined;
      const payout = await transition<Payout>(trx, "payouts", id, ["pending"], "cancelled");
      await walletModel.move(trx, {
        userId: driverUserId,
        delta: { balance: Number(payout.amount) },
        row: { id: payout.transactionId, status: "failed" },
      });
      return this.sanitize(payout);
    });
  }

  async listByDriver(driverUserId: string, { status, page, limit }: ListPayoutsQuery) {
    const matching = () =>
      this.table.where({ driverUserId }).modify((query) => {
        if (status) query.where({ status });
      });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .select("*")
        .orderBy([
          { column: "createdAt", order: "desc" },
          { column: "id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<Payout[]>,
    ]);

    return { totalItems: counted.total, items: rows.map((row) => this.sanitize(row)) };
  }
}

export const payoutModel = new PayoutModel();
