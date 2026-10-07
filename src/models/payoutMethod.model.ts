import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";
import { BaseModel } from "./BaseModel.js";
import type { AdminListPayoutMethodsQuery, PayoutFrequency } from "../schemas/payout.schema.js";

export interface PayoutMethod {
  id: string;
  paymentMethodId: string;
  driverUserId: string;
  isAutomatic: boolean;
  minimumThreshold: number;
  payoutFrequency: PayoutFrequency;
  isPrimary: boolean;
  lastPayoutAt: Date | null;
  nextScheduledPayout: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutSettings {
  isAutomatic: boolean;
  minimumThreshold: number;
  payoutFrequency: PayoutFrequency;
}

export interface PayoutMethodWithPayment extends PayoutMethod {
  paymentType: "card" | "mobile_money" | "bank_account";
  paymentDisplayName: string;
  paymentVerificationStatus: "pending" | "verified" | "failed";
}

const WITH_PAYMENT = [
  "payoutMethods.*",
  "paymentMethods.type as paymentType",
  "paymentMethods.displayName as paymentDisplayName",
  "paymentMethods.verificationStatus as paymentVerificationStatus",
];

class PayoutMethodModel extends BaseModel<PayoutMethod> {
  protected readonly tableName = "payoutMethods";

  // pg returns numeric columns as strings; clients get numbers.
  protected sanitize<R extends PayoutMethod>(row: R): R {
    return { ...row, minimumThreshold: Number(row.minimumThreshold) };
  }

  private withPayment() {
    return this.table.join("paymentMethods", "payoutMethods.paymentMethodId", "paymentMethods.id");
  }

  async findWithPayment(id: string): Promise<PayoutMethodWithPayment | undefined> {
    const row = await this.withPayment().where("payoutMethods.id", id).first(WITH_PAYMENT);
    return row && this.sanitize(row);
  }

  async findOwned(id: string, driverUserId: string): Promise<PayoutMethodWithPayment | undefined> {
    const row = await this.withPayment()
      .where({ "payoutMethods.id": id, "payoutMethods.driverUserId": driverUserId })
      .first(WITH_PAYMENT);
    return row && this.sanitize(row);
  }

  async listByDriver(driverUserId: string): Promise<PayoutMethodWithPayment[]> {
    const rows = await this.withPayment()
      .where("payoutMethods.driverUserId", driverUserId)
      .orderBy([
        { column: "payoutMethods.isPrimary", order: "desc" },
        { column: "payoutMethods.createdAt", order: "desc" },
      ])
      .select(WITH_PAYMENT);
    return rows.map((row: PayoutMethodWithPayment) => this.sanitize(row));
  }

  async adminList({ driverId, isAutomatic, page, limit }: AdminListPayoutMethodsQuery) {
    const matching = () =>
      this.withPayment().modify((query) => {
        if (driverId) query.where("payoutMethods.driverUserId", driverId);
        if (isAutomatic !== undefined) query.where("payoutMethods.isAutomatic", isAutomatic);
      });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .select(WITH_PAYMENT)
        .orderBy([
          { column: "payoutMethods.createdAt", order: "desc" },
          { column: "payoutMethods.id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<PayoutMethodWithPayment[]>,
    ]);

    return { totalItems: counted.total, items: rows.map((row) => this.sanitize(row)) };
  }

  // A driver's first payout method becomes their primary one.
  async createMethod(
    paymentMethodId: string,
    driverUserId: string,
    settings: PayoutSettings,
  ): Promise<PayoutMethodWithPayment> {
    try {
      const id = randomUUID();
      await db.transaction(async (trx) => {
        const existing = await trx(this.tableName).where({ driverUserId }).first("id");
        await trx(this.tableName).insert({
          id,
          paymentMethodId,
          driverUserId,
          ...settings,
          isPrimary: !existing,
        });
      });
      return (await this.findWithPayment(id))!;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw AppError.conflict("This payment method is already set up for payouts");
      }
      this.handleDbError(err);
    }
  }

  async updateSettings(id: string, changes: Partial<PayoutSettings>) {
    await this.table.where({ id }).update({ ...changes, updatedAt: new Date() });
    return this.findWithPayment(id);
  }

  async setPrimary(id: string, driverUserId: string) {
    try {
      await db.transaction(async (trx) => {
        await trx(this.tableName)
          .where({ driverUserId, isPrimary: true })
          .update({ isPrimary: false });
        await trx(this.tableName)
          .where({ id, driverUserId })
          .update({ isPrimary: true, updatedAt: new Date() });
      });
    } catch (err) {
      this.handleDbError(err);
    }
    return this.findWithPayment(id);
  }

  // If the primary one goes, the newest remaining takes over.
  async remove(id: string): Promise<void> {
    await db.transaction(async (trx) => {
      const [removed] = await trx(this.tableName).where({ id }).del().returning("driverUserId");
      if (removed) await this.ensurePrimary(trx, removed.driverUserId);
    });
  }

  async ensurePrimary(trx: Knex.Transaction, driverUserId: string): Promise<void> {
    const hasPrimary = await trx(this.tableName)
      .where({ driverUserId, isPrimary: true })
      .first("id");
    if (hasPrimary) return;

    const newest = await trx(this.tableName)
      .where({ driverUserId })
      .orderBy("createdAt", "desc")
      .first("id");
    if (newest) await trx(this.tableName).where({ id: newest.id }).update({ isPrimary: true });
  }
}

export const payoutMethodModel = new PayoutMethodModel();
