import { BaseModel } from "./BaseModel.js";

export interface UserStatusHistory {
  id: string;
  userId: string;
  previousStatus: string;
  newStatus: string;
  reason: string | null;
  notes: string | null;
  changedBy: string | null;
  changedAt: Date;
  createdAt: Date;
}

export class UserStatusHistoryModel extends BaseModel<UserStatusHistory> {
  protected readonly tableName = "userStatusHistory";

  async logStatusChange(
    userId: string,
    previousStatus: string,
    newStatus: string,
    changedBy: string | null,
    reason?: string | null,
    notes?: string | null,
  ): Promise<UserStatusHistory> {
    return this.insert({
      userId,
      previousStatus,
      newStatus,
      reason: reason ?? null,
      notes: notes ?? null,
      changedBy,
    } as unknown as Partial<UserStatusHistory>);
  }

  async getHistory(userId: string): Promise<UserStatusHistory[]> {
    return this.table.where({ userId }).orderBy("changedAt", "desc");
  }
}

export const userStatusHistoryModel = new UserStatusHistoryModel();
