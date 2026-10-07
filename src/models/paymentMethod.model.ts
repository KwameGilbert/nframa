import { randomUUID } from "node:crypto";
import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";
import { BaseModel } from "./BaseModel.js";
import { payoutMethodModel } from "./payoutMethod.model.js";
import type {
  AdminListPaymentMethodsQuery,
  PaymentMethodType,
  VerificationStatus,
} from "../schemas/paymentMethod.schema.js";

export interface PaymentMethod {
  id: string;
  userId: string;
  userRole: "rider" | "driver";
  type: PaymentMethodType;
  displayName: string;
  // The full details as saved. Never returned as-is: the controller masks them.
  metadata: Record<string, unknown>;
  isVerified: boolean;
  verificationStatus: VerificationStatus;
  verificationCompletedAt: Date | null;
  isActive: boolean;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface NewPaymentMethod {
  userId: string;
  userRole: PaymentMethod["userRole"];
  type: PaymentMethodType;
  identifier: string;
  displayName: string;
  metadata: Record<string, unknown>;
}

class PaymentMethodModel extends BaseModel<PaymentMethod> {
  protected readonly tableName = "paymentMethods";
  // The provider's token (attached when charging is integrated) and the duplicate-check key stay internal.
  protected readonly excludedColumns = ["tokenizedReference", "identifier", "provider"];

  async createMethod(input: NewPaymentMethod): Promise<PaymentMethod> {
    try {
      const [row] = await this.table
        .insert({ ...input, id: randomUUID(), metadata: JSON.stringify(input.metadata) })
        .returning("*");
      return this.sanitize(row);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw AppError.conflict("You have already saved this payment method");
      }
      this.handleDbError(err);
    }
  }

  async findOwned(id: string, userId: string): Promise<PaymentMethod | undefined> {
    const row = await this.table.where({ id, userId, isActive: true }).first();
    return row && this.sanitize(row);
  }

  async findActive(id: string): Promise<PaymentMethod | undefined> {
    const row = await this.table.where({ id, isActive: true }).first();
    return row && this.sanitize(row);
  }

  async listByUser(userId: string, verified?: boolean): Promise<PaymentMethod[]> {
    const rows = await this.table
      .where({ userId, isActive: true })
      .modify((query) => {
        if (verified !== undefined) query.where({ isVerified: verified });
      })
      .orderBy([
        { column: "isPrimary", order: "desc" },
        { column: "createdAt", order: "desc" },
      ]);
    return rows.map((row: PaymentMethod) => this.sanitize(row));
  }

  async adminList({
    userId,
    userRole,
    verificationStatus,
    page,
    limit,
  }: AdminListPaymentMethodsQuery) {
    const matching = () =>
      this.table.where({ isActive: true }).modify((query) => {
        if (userId) query.where({ userId });
        if (userRole) query.where({ userRole });
        if (verificationStatus) query.where({ verificationStatus });
      });

    const [counted, rows] = await Promise.all([
      matching().first(db.raw("count(*)::int as total")) as Promise<{ total: number }>,
      matching()
        .orderBy([
          { column: "createdAt", order: "desc" },
          { column: "id", order: "desc" },
        ])
        .limit(limit)
        .offset((page - 1) * limit) as Promise<PaymentMethod[]>,
    ]);

    return { totalItems: counted.total, items: rows.map((row) => this.sanitize(row)) };
  }

  async rename(id: string, displayName: string): Promise<PaymentMethod | undefined> {
    const [row] = await this.table
      .where({ id })
      .update({ displayName, updatedAt: new Date() })
      .returning("*");
    return row && this.sanitize(row);
  }

  // One primary per person (the unique index decides if two requests race).
  async setPrimary(id: string, userId: string): Promise<PaymentMethod | undefined> {
    try {
      return await db.transaction(async (trx) => {
        await trx(this.tableName).where({ userId, isPrimary: true }).update({ isPrimary: false });
        const [row] = await trx(this.tableName)
          .where({ id, userId, isActive: true })
          .update({ isPrimary: true, updatedAt: new Date() })
          .returning("*");
        return row && this.sanitize(row);
      });
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // Only a verified method can be primary: losing verification drops it, and the first one to be verified
  // becomes primary if the person has none.
  async setVerification(
    id: string,
    status: VerificationStatus,
  ): Promise<PaymentMethod | undefined> {
    try {
      return await db.transaction(async (trx) => {
        const verified = status === "verified";
        const [row] = await trx(this.tableName)
          .where({ id, isActive: true })
          .update({
            verificationStatus: status,
            isVerified: verified,
            verificationCompletedAt: verified ? new Date() : null,
            ...(verified ? {} : { isPrimary: false }),
            updatedAt: new Date(),
          })
          .returning("*");
        if (!row) return undefined;

        if (verified && !row.isPrimary) {
          const hasPrimary = await trx(this.tableName)
            .where({ userId: row.userId, isPrimary: true, isActive: true })
            .first("id");
          if (!hasPrimary) {
            row.isPrimary = true;
            await trx(this.tableName).where({ id }).update({ isPrimary: true });
          }
        }
        return this.sanitize(row);
      });
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // Soft delete: the row stays for the audit trail. A payout method built on it goes with it.
  async deactivate(id: string): Promise<PaymentMethod | undefined> {
    return db.transaction(async (trx) => {
      const removed: { driverUserId: string }[] = await trx("payoutMethods")
        .where({ paymentMethodId: id })
        .del()
        .returning("driverUserId");
      const [row] = await trx(this.tableName)
        .where({ id, isActive: true })
        .update({ isActive: false, isPrimary: false, updatedAt: new Date() })
        .returning("*");

      for (const { driverUserId } of removed) {
        await payoutMethodModel.ensurePrimary(trx, driverUserId);
      }
      return row && this.sanitize(row);
    });
  }
}

export const paymentMethodModel = new PaymentMethodModel();
