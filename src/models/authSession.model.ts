import { BaseModel } from "./BaseModel.js";

export interface AuthSession {
  id: string;
  userType: string;
  userId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ipAddress: string;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface CreateSessionInput {
  userType: "user" | "admin";
  userId: string;
  refreshTokenHash: string;
  userAgent?: string | null;
  ipAddress: string;
  expiresAt: Date;
}

class AuthSessionModel extends BaseModel<AuthSession> {
  protected readonly tableName = "authSessions";
  protected readonly excludedColumns = ["refreshTokenHash"];

  createSession(input: CreateSessionInput) {
    return this.insert({ ...input, lastUsedAt: new Date() });
  }

  findActiveByTokenHash(refreshTokenHash: string): Promise<AuthSession | undefined> {
    return this.table
      .where({ refreshTokenHash })
      .whereNull("revokedAt")
      .where("expiresAt", ">", new Date())
      .first();
  }

  touch(id: string) {
    return this.updateById(id, { lastUsedAt: new Date() });
  }

  revoke(id: string) {
    return this.updateById(id, { revokedAt: new Date() });
  }

  revokeAllForUser(userId: string) {
    return this.table.where({ userId }).whereNull("revokedAt").update({ revokedAt: new Date() });
  }
}

export const authSessionModel = new AuthSessionModel();
