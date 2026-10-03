import { randomUUID } from "node:crypto";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";

export interface PaymentMethod {
  id: string;
  userId: string;
  userRole: "rider" | "driver";
  type: "card" | "mobile_money" | "bank_account";
  provider: "hubtel" | "paystack";
  tokenizedReference: string;
  displayName: string;
  isVerified: boolean;
  verificationStatus: "pending" | "verified" | "failed";
  verificationToken?: string;
  verificationAttempts: number;
  verificationFailedAt?: Date;
  verificationCompletedAt?: Date;
  isActive: boolean;
  isPrimary: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

class PaymentMethodModel extends BaseModel<PaymentMethod> {
  protected readonly tableName = "paymentMethods";

  async create(
    userId: string,
    userRole: "rider" | "driver",
    type: PaymentMethod["type"],
    provider: PaymentMethod["provider"],
    tokenizedReference: string,
    displayName: string,
    metadata: Record<string, unknown>,
  ): Promise<PaymentMethod> {
    const [row] = await this.table
      .insert({
        id: randomUUID(),
        userId,
        userRole,
        type,
        provider,
        tokenizedReference,
        displayName,
        metadata: JSON.stringify(metadata),
        verificationStatus: "pending",
        isVerified: false,
        isActive: true,
        isPrimary: false,
        verificationAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning("*");

    return this.sanitizeRow(row);
  }

  async findActiveByUser(userId: string, verified?: boolean) {
    let query = this.table.where({ userId, isActive: true });
    if (verified !== undefined) {
      query = query.where({ isVerified: verified });
    }
    return query.orderBy("isPrimary", "desc").orderBy("createdAt", "desc");
  }

  async listByUser(userId: string, verified?: boolean, limit = 100, offset = 0) {
    let query = this.table.where({ userId, isActive: true });
    if (verified !== undefined) {
      query = query.where({ isVerified: verified });
    }

    const [items, countResult] = await Promise.all([
      query
        .clone()
        .orderBy("isPrimary", "desc")
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

  async setAsPrimary(id: string, userId: string): Promise<PaymentMethod | undefined> {
    await this.table.where({ userId, isPrimary: true }).update({ isPrimary: false });

    const [row] = await this.table
      .where({ id, userId })
      .update({ isPrimary: true, updatedAt: new Date() })
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  async requestVerification(id: string, verificationToken: string): Promise<PaymentMethod | undefined> {
    const [row] = await this.table
      .where({ id })
      .update({
        verificationToken,
        verificationStatus: "pending",
        verificationAttempts: this.table.raw("?? + 1", ["verificationAttempts"]),
        updatedAt: new Date(),
      })
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  async verify(id: string): Promise<PaymentMethod | undefined> {
    const [row] = await this.table
      .where({ id })
      .update({
        isVerified: true,
        verificationStatus: "verified",
        verificationCompletedAt: new Date(),
        verificationToken: null,
        updatedAt: new Date(),
      })
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  async markVerificationFailed(id: string): Promise<PaymentMethod | undefined> {
    const [row] = await this.table
      .where({ id })
      .update({
        verificationStatus: "failed",
        verificationFailedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  async softDelete(id: string): Promise<PaymentMethod | undefined> {
    const [row] = await this.table
      .where({ id })
      .update({ isActive: false, updatedAt: new Date() })
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  async findByTokenReference(userId: string, tokenReference: string): Promise<PaymentMethod | undefined> {
    const row = await this.table
      .where({ userId, tokenizedReference: tokenReference })
      .first();

    return row && this.sanitizeRow(row);
  }

  // Admin methods
  async adminListAll(filters?: {
    userId?: string;
    userRole?: "rider" | "driver";
    isVerified?: boolean;
    page?: number;
    limit?: number;
  }) {
    let query = this.table.clone();

    if (filters?.userId) {
      query = query.where({ userId: filters.userId });
    }
    if (filters?.userRole) {
      query = query.where({ userRole: filters.userRole });
    }
    if (filters?.isVerified !== undefined) {
      query = query.where({ isVerified: filters.isVerified });
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

  async adminUpdate(
    id: string,
    updates: Partial<PaymentMethod>,
  ): Promise<PaymentMethod | undefined> {
    const [row] = await this.table
      .where({ id })
      .update({
        ...updates,
        updatedAt: new Date(),
      })
      .returning("*");

    return row && this.sanitizeRow(row);
  }

  private sanitizeRow(row: PaymentMethod): PaymentMethod {
    return {
      ...row,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    };
  }
}

export const paymentMethodModel = new PaymentMethodModel();
