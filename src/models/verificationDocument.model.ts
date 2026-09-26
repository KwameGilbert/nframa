import { BaseModel } from "./BaseModel.js";
import type { VerificationDocument } from "../schemas/verification.schema.js";
import type { StorageDriver } from "../services/storage.service.js";

// storageKey/storageDriver exist on the row but are never part of the public response shape (see
// excludedColumns below) — they're only needed internally, to delete the underlying file later.
export type VerificationDocumentRow = VerificationDocument & {
  storageKey: string;
  storageDriver: StorageDriver;
};

// Columns safe to return to clients. Custom queries below use `this.table` directly, which — unlike
// findById/findOne/updateById — doesn't run through BaseModel's sanitize(), so they select these
// explicitly instead of `.select("*")` to keep storageKey/storageDriver from ever reaching a response.
const PUBLIC_COLUMNS = [
  "id",
  "userId",
  "documentTypeId",
  "fileUrl",
  "status",
  "expiresAt",
  "notes",
  "uploadedAt",
  "verifiedAt",
  "verifiedBy",
  "createdAt",
  "updatedAt",
];

export class VerificationDocumentModel extends BaseModel<VerificationDocumentRow> {
  protected readonly tableName = "verificationDocuments";
  protected readonly excludedColumns = ["storageKey", "storageDriver"];

  async uploadDocument(
    userId: string,
    documentTypeId: number,
    fileUrl: string,
    storageKey: string,
    storageDriver: StorageDriver,
    expiresAt?: string,
  ): Promise<VerificationDocumentRow> {
    return this.insert({
      userId,
      documentTypeId,
      fileUrl,
      storageKey,
      storageDriver,
      expiresAt,
      status: "PENDING",
    } as unknown as Partial<VerificationDocumentRow>);
  }

  async getDocumentsByUserId(userId: string): Promise<VerificationDocumentRow[]> {
    return this.table.where({ userId }).select(PUBLIC_COLUMNS).orderBy("createdAt", "desc");
  }

  async getDocumentsByType(documentTypeId: number): Promise<VerificationDocumentRow[]> {
    return this.table
      .where({ documentTypeId })
      .select(PUBLIC_COLUMNS)
      .orderBy("uploadedAt", "desc");
  }

  // Kept internal (includes storageKey/storageDriver) — used to check for a prior submission before
  // insert, and by the caller to delete the old file if the driver is ever allowed to resubmit.
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
    return (
      this.table
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where((qb: any) => {
          qb.where({ status: "PENDING" }).orWhere({ status: "UNDER_REVIEW" });
        })
        .join("users", "verificationDocuments.userId", "users.id")
        .join("documentTypes", "verificationDocuments.documentTypeId", "documentTypes.id")
        .select(
          ...PUBLIC_COLUMNS.map((column) => `verificationDocuments.${column}`),
          "users.fullName",
          "users.email",
          "users.phoneNumber",
          "documentTypes.code as documentTypeCode",
          "documentTypes.name as documentTypeName",
        )
        .orderBy("verificationDocuments.uploadedAt", "asc")
    );
  }
}

export const verificationDocumentModel = new VerificationDocumentModel();
