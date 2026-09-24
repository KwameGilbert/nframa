import { BaseModel } from "./BaseModel.js";

export interface OtpCode {
  id: string;
  identifier: string;
  channel: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
}

export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;

interface CreateOtpInput {
  identifier: string;
  channel: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
}

class OtpCodeModel extends BaseModel<OtpCode> {
  protected readonly tableName = "otpCodes";
  protected readonly excludedColumns = ["codeHash"];

  createOtp(input: CreateOtpInput) {
    return this.insert(input);
  }

  findLatestPending(identifier: string, purpose: string): Promise<OtpCode | undefined> {
    return this.table
      .where({ identifier, purpose })
      .whereNull("consumedAt")
      .orderBy("createdAt", "desc")
      .first();
  }

  incrementAttempts(id: string) {
    return this.table.where({ id }).increment("attemptCount", 1);
  }

  // Consumes every outstanding code, not just the one used — otherwise an older, still-unexpired code
  // would become the "latest pending" and could be used a second time.
  consumeAllPending(identifier: string, purpose: string) {
    return this.table
      .where({ identifier, purpose })
      .whereNull("consumedAt")
      .update({ consumedAt: new Date() });
  }
}

export const otpCodeModel = new OtpCodeModel();
