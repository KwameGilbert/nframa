import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { pushDeviceModel } from "./pushDevice.model.js";

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

  revoke(id: string, trx: Knex = db) {
    return trx(this.tableName).where({ id }).update({ revokedAt: new Date() });
  }

  // Logout: revokes the session and removes the push device the app named (the session user's own only) in one
  // transaction, so a failure leaves both in place and a retried logout still finds the session.
  async signOut(session: Pick<AuthSession, "id" | "userId">, pushToken?: string): Promise<void> {
    if (!pushToken) {
      await this.revoke(session.id);
      return;
    }
    await db.transaction(async (trx) => {
      await this.revoke(session.id, trx);
      await pushDeviceModel.removeByToken(pushToken, session.userId, trx);
    });
  }

  revokeAllForUser(userId: string, trx: Knex = db) {
    return trx(this.tableName)
      .where({ userId })
      .whereNull("revokedAt")
      .update({ revokedAt: new Date() });
  }
}

export const authSessionModel = new AuthSessionModel();
