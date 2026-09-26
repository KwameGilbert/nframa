import { BaseModel } from "./BaseModel.js";
import type { VerificationDocument } from "../schemas/verification.schema.js";

export type VerificationDocumentRow = VerificationDocument;

export class VerificationDocumentModel extends BaseModel<VerificationDocumentRow> {
  protected readonly tableName = "verificationDocuments";

  async uploadDocument(
    userId: string,
    documentTypeId: number,
    fileUrl: string,
    expiresAt?: string,
  ): Promise<VerificationDocumentRow> {
    return this.insert({
      userId,
      documentTypeId,
      fileUrl,
      expiresAt,
      status: "PENDING",
    } as unknown as Partial<VerificationDocumentRow>);
  }

  async getDocumentsByUserId(userId: string): Promise<VerificationDocumentRow[]> {
    return this.table.where({ userId }).orderBy("createdAt", "desc");
  }

  async getDocumentsByType(documentTypeId: number): Promise<VerificationDocumentRow[]> {
    return this.table.where({ documentTypeId }).orderBy("uploadedAt", "desc");
  }

  async getDocumentByUserAndType(
    userId: string,
    documentTypeId: number,
  ): Promise<VerificationDocumentRow | undefined> {
    return this.table.where({ userId, documentTypeId }).first();
  }

  async updateStatus(
    id: string,
    status: string,
    verifiedBy?: string,
    notes?: string,
  ): Promise<VerificationDocumentRow | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {
      status,
      updatedAt: new Date(),
    };

    if (notes !== undefined) {
      updates.notes = notes;
    }

    if (status === "VERIFIED") {
      updates.verifiedAt = new Date();
      if (verifiedBy) {
        updates.verifiedBy = verifiedBy;
      }
    }

    await this.table.where({ id }).update(updates);
    return this.findById(id);
  }

  async getExpiredDocuments(): Promise<VerificationDocumentRow[]> {
    return this.table
      .where({ status: "VERIFIED" })
      .whereNotNull("expiresAt")
      .where("expiresAt", "<", new Date());
  }

  async countByUserAndStatus(userId: string, status: string): Promise<number> {
    const result = await this.table.where({ userId, status }).count("*", { as: "count" }).first();
    return Number((result as Record<string, unknown>)?.count) || 0;
  }

  async getAllVerifiedCount(userId: string): Promise<number> {
    const result = await this.table
      .where({ userId, status: "VERIFIED" })
      .count("*", { as: "count" })
      .first();
    return Number((result as Record<string, unknown>)?.count) || 0;
  }

  async getAnyRejectedCount(userId: string): Promise<number> {
    const result = await this.table
      .where({ userId, status: "REJECTED" })
      .count("*", { as: "count" })
      .first();
    return Number((result as Record<string, unknown>)?.count) || 0;
  }

  async getPendingDocumentsWithDetails() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.table.where((qb: any) => {
      qb.where({ status: "PENDING" }).orWhere({ status: "UNDER_REVIEW" });
    })
      .join("users", "verificationDocuments.userId", "users.id")
      .join("documentTypes", "verificationDocuments.documentTypeId", "documentTypes.id")
      .select(
        "verificationDocuments.*",
        "users.fullName",
        "users.email",
        "users.phoneNumber",
        "documentTypes.code as documentTypeCode",
        "documentTypes.name as documentTypeName",
      )
      .orderBy("verificationDocuments.uploadedAt", "asc");
  }
}

export const verificationDocumentModel = new VerificationDocumentModel();
