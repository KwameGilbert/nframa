import { BaseModel } from "./BaseModel.js";

export interface VerificationDocumentHistory {
  id: string;
  documentId: string;
  previousStatus: string | null;
  newStatus: string;
  changedBy: string | null;
  reason: string | null;
  changedAt: Date;
  createdAt: Date;
}

export type VerificationDocumentHistoryRow = VerificationDocumentHistory;

export class VerificationDocumentHistoryModel extends BaseModel<VerificationDocumentHistoryRow> {
  protected readonly tableName = "verificationDocumentHistory";

  async logStatusChange(
    documentId: string,
    previousStatus: string | null,
    newStatus: string,
    changedBy: string | null,
    reason?: string,
  ): Promise<VerificationDocumentHistoryRow> {
    return this.insert({
      documentId,
      previousStatus,
      newStatus,
      changedBy,
      reason,
    } as unknown as Partial<VerificationDocumentHistoryRow>);
  }

  async getDocumentHistory(documentId: string): Promise<VerificationDocumentHistoryRow[]> {
    return this.table.where({ documentId }).orderBy("changedAt", "desc");
  }

  async getLatestStatusChange(
    documentId: string,
  ): Promise<VerificationDocumentHistoryRow | undefined> {
    return this.table.where({ documentId }).orderBy("changedAt", "desc").first();
  }
}

export const verificationDocumentHistoryModel = new VerificationDocumentHistoryModel();
