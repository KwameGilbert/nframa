import { randomUUID } from "node:crypto";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";

export interface PayoutHistory {
  id: string;
  driverUserId: string;
  payoutMethodId: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed";
  providerReference?: string;
  failureReason?: string;
  initiatedBy: string;
  initiationType: "manual" | "automatic";
  metadata: Record<string, unknown>;
  initiatedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

class PayoutHistoryModel extends BaseModel<PayoutHistory> {
  protected readonly tableName = "payoutHistory";

  async record(
    driverUserId: string,
    payoutMethodId: string,
    amount: number,
    status: "pending" | "processing" | "completed" | "failed",
    initiatedBy: string,
    initiationType: "manual" | "automatic",
    providerReference?: string,
    metadata?: Record<string, unknown>,
  ): Promise<PayoutHistory> {
    const [row] = await this.table
      .insert({
        id: randomUUID(),
        driverUserId,
        payoutMethodId,
        amount,
        currency: "GHS",
        status,
        providerReference: providerReference || null,
        initiatedBy,
        initiationType,
        metadata: JSON.stringify(metadata || {}),
        initiatedAt: new Date(),
        createdAt: new Date(),
      })
      .returning("*");

    return this.sanitizeRow(row);
  }

  async listByDriver(
    driverUserId: string,
    status?: "pending" | "processing" | "completed" | "failed",
    limit = 20,
    offset = 0,
  ) {
    let query = this.table.where({ driverUserId });

    if (status) {
      query = query.where({ status });
    }

    const [items, countResult] = await Promise.all([
      query
        .clone()
        .orderBy("createdAt", "desc")
        .limit(limit)
        .offset(offset),
      query.clone().count("* as total").first() as Promise<{ total: number }>,
    ]);

    return {
      items: items.map((r) => this.sanitizeRow(r)),
      total: countResult?.total || 0,
    };
  }

  async updateStatus(
    id: string,
    status: "pending" | "processing" | "completed" | "failed",
    failureReason?: string,
  ): Promise<PayoutHistory | undefined> {
    const updates: Record<string, unknown> = { status };

    if (failureReason) {
      updates.failureReason = failureReason;
    }

    if (status === "completed") {
      updates.completedAt = new Date();
    }

    const [row] = await this.table
      .where({ id })
      .update(updates)
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  async getStats(driverUserId: string) {
    const results = await this.table
      .where({ driverUserId })
      .select(
        db.raw("status"),
        db.raw("SUM(CASE WHEN status = ? THEN amount ELSE 0 END)::numeric as totalCompleted", [
          "completed",
        ]),
        db.raw("SUM(CASE WHEN status IN (?, ?) THEN amount ELSE 0 END)::numeric as totalPending", [
          "pending",
          "processing",
        ]),
        db.raw("SUM(CASE WHEN status = ? THEN amount ELSE 0 END)::numeric as totalFailed", [
          "failed",
        ]),
        db.raw("COUNT(CASE WHEN status = ? THEN 1 END) as completedCount", ["completed"]),
        db.raw("COUNT(CASE WHEN status = ? THEN 1 END) as failedCount", ["failed"]),
        db.raw("MAX(CASE WHEN status = ? THEN completedAt END) as lastPayoutAt", ["completed"]),
      )
      .groupBy("driverUserId")
      .first();

    if (!results) {
      return {
        totalPaid: 0,
        totalPending: 0,
        totalFailed: 0,
        lastPayoutAt: null,
        completedPayoutCount: 0,
        failedPayoutCount: 0,
      };
    }

    return {
      totalPaid: Number(results.totalCompleted || 0),
      totalPending: Number(results.totalPending || 0),
      totalFailed: Number(results.totalFailed || 0),
      lastPayoutAt: results.lastPayoutAt,
      completedPayoutCount: results.completedCount || 0,
      failedPayoutCount: results.failedCount || 0,
    };
  }

  async findByReference(providerReference: string): Promise<PayoutHistory | undefined> {
    const row = await this.table.where({ providerReference }).first();
    return row && this.sanitizeRow(row);
  }

  // Admin methods
  async adminListAll(filters?: {
    driverUserId?: string;
    status?: "pending" | "processing" | "completed" | "failed";
    page?: number;
    limit?: number;
  }) {
    let query = this.table.clone();

    if (filters?.driverUserId) {
      query = query.where({ driverUserId: filters.driverUserId });
    }
    if (filters?.status) {
      query = query.where({ status: filters.status });
    }

    const limit = filters?.limit || 20;
    const offset = ((filters?.page || 1) - 1) * limit;

    const [items, countResult] = await Promise.all([
      query
        .clone()
        .orderBy("createdAt", "desc")
        .limit(limit)
        .offset(offset),
      query.clone().count("* as total").first() as Promise<{ total: number }>,
    ]);

    return {
      items: items.map((r) => this.sanitizeRow(r)),
      total: countResult?.total || 0,
    };
  }

  private sanitizeRow(row: PayoutHistory): PayoutHistory {
    return {
      ...row,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    };
  }
}

export const payoutHistoryModel = new PayoutHistoryModel();
