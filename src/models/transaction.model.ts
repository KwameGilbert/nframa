import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type {
  ListTransactionsQuery,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from "../schemas/wallet.schema.js";

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  direction: TransactionDirection;
  amount: number;
  currency: string;
  status: TransactionStatus;
  provider: string | null;
  providerReference: string | null;
  tripId: string | null;
  balanceAfter: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// pg returns numeric columns as strings; clients get numbers.
export function toTransaction(row: Transaction): Transaction {
  return {
    ...row,
    amount: Number(row.amount),
    balanceAfter: row.balanceAfter === null ? null : Number(row.balanceAfter),
  };
}

// Reads and pending top-ups only. Anything that changes a balance goes through walletModel.
class TransactionModel extends BaseModel<Transaction> {
  protected readonly tableName = "transactions";

  protected sanitize(row: Transaction): Transaction {
    return toTransaction(row);
  }

  createPendingTopUp(input: {
    userId: string;
    amount: number;
    provider: string;
    providerReference: string;
  }) {
    return this.insert({ ...input, type: "topup", direction: "credit", status: "pending" });
  }

  findByReference(providerReference: string) {
    return this.findOne({ providerReference });
  }

  // Only a pending transaction can fail, so a late failure never undoes one that already succeeded.
  async markFailed(id: string, failureReason: string): Promise<Transaction | undefined> {
    const [row] = await this.table
      .where({ id, status: "pending" })
      .update({
        status: "failed",
        metadata: db.raw(`coalesce("metadata", '{}'::jsonb) || ?::jsonb`, [
          JSON.stringify({ failureReason }),
        ]),
        updatedAt: new Date(),
      })
      .returning("*");
    return row && this.sanitize(row);
  }

  async listForUser(userId: string, { page, limit, type, status }: ListTransactionsQuery) {
    const filtered = () =>
      this.table.where({ userId, ...(type && { type }), ...(status && { status }) });

    const [count, rows] = await Promise.all([
      filtered().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      filtered()
        .orderBy([
          { column: "createdAt", order: "desc" },
          { column: "id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<Transaction[]>,
    ]);

    return { items: rows.map(toTransaction), total: count.total };
  }
}

export const transactionModel = new TransactionModel();
