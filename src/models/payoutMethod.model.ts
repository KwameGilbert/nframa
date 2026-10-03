import { randomUUID } from "node:crypto";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";

export interface PayoutMethod {
  id: string;
  paymentMethodId: string;
  driverUserId: string;
  isAutomatic: boolean;
  minimumThreshold: number;
  payoutFrequency: "daily" | "weekly" | "monthly";
  lastPayoutAt?: Date;
  nextScheduledPayout?: Date;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

class PayoutMethodModel extends BaseModel<PayoutMethod> {
  protected readonly tableName = "payoutMethods";

  async create(
    paymentMethodId: string,
    driverUserId: string,
    isAutomatic: boolean,
    minimumThreshold: number,
    payoutFrequency: "daily" | "weekly" | "monthly",
  ): Promise<PayoutMethod> {
    const [row] = await this.table
      .insert({
        id: randomUUID(),
        paymentMethodId,
        driverUserId,
        isAutomatic,
        minimumThreshold,
        payoutFrequency,
        isPrimary: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning("*");

    return row;
  }

  async listByDriver(driverUserId: string) {
    return this.table
      .where({ driverUserId })
      .orderBy("isPrimary", "desc")
      .orderBy("createdAt", "desc");
  }

  async getPrimary(driverUserId: string): Promise<PayoutMethod | undefined> {
    return this.table.where({ driverUserId, isPrimary: true }).first();
  }

  async setPrimary(id: string, driverUserId: string): Promise<PayoutMethod | undefined> {
    await this.table.where({ driverUserId, isPrimary: true }).update({ isPrimary: false });

    const [row] = await this.table
      .where({ id, driverUserId })
      .update({ isPrimary: true, updatedAt: new Date() })
      .returning("*");

    return row;
  }

  async setAutomatic(
    id: string,
    isAutomatic: boolean,
    minimumThreshold?: number,
    payoutFrequency?: "daily" | "weekly" | "monthly",
  ): Promise<PayoutMethod | undefined> {
    const updates: Record<string, unknown> = {
      isAutomatic,
      updatedAt: new Date(),
    };

    if (minimumThreshold !== undefined) {
      updates.minimumThreshold = minimumThreshold;
    }
    if (payoutFrequency !== undefined) {
      updates.payoutFrequency = payoutFrequency;
    }

    const [row] = await this.table
      .where({ id })
      .update(updates)
      .returning("*");

    return row;
  }

  async recordPayout(id: string, amount: number): Promise<PayoutMethod | undefined> {
    const now = new Date();
    const nextScheduled = this.calculateNextScheduled(now);

    const [row] = await this.table
      .where({ id })
      .update({
        lastPayoutAt: now,
        nextScheduledPayout: nextScheduled,
        updatedAt: now,
      })
      .returning("*");

    return row;
  }

  async listForAutomaticPayout() {
    const now = new Date();
    return this.table
      .where({ isAutomatic: true })
      .where((qb) => {
        qb.whereNull("nextScheduledPayout").orWhere("nextScheduledPayout", "<=", now);
      })
      .orderBy("createdAt");
  }

  // Admin methods
  async adminListAll(filters?: {
    driverUserId?: string;
    isAutomatic?: boolean;
    page?: number;
    limit?: number;
  }) {
    let query = this.table.clone();

    if (filters?.driverUserId) {
      query = query.where({ driverUserId: filters.driverUserId });
    }
    if (filters?.isAutomatic !== undefined) {
      query = query.where({ isAutomatic: filters.isAutomatic });
    }

    const limit = filters?.limit || 20;
    const offset = ((filters?.page || 1) - 1) * limit;

    const [items, countResult] = await Promise.all([
      query
        .clone()
        .orderBy("createdAt", "desc")
        .limit(limit)
        .offset(offset),
      query.clone().count("* as total").first() as unknown as Promise<{ total: number }>,
    ]);

    return {
      items,
      total: countResult?.total || 0,
    };
  }

  private calculateNextScheduled(now: Date): Date {
    const next = new Date(now);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + 1);
    return next;
  }
}

export const payoutMethodModel = new PayoutMethodModel();
