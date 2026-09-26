import { randomBytes } from "node:crypto";
import { BaseModel } from "./BaseModel.js";
import type {
  CreateDriverProfileInput,
  UpdateDriverProfileInput,
} from "../schemas/driverProfile.schema.js";

export interface DriverProfile {
  userId: string;
  code: string;
  verificationStatus: string;
  ghanaCardNumber: string | null;
  address: string | null;
  isOnline: boolean;
  autoAcceptBookings: boolean;
  termsAcceptedAt: Date | null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateDriverCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (const byte of bytes) {
    code += CODE_CHARS[byte % CODE_CHARS.length];
  }
  return `DR-${code}`;
}

class DriverProfileModel extends BaseModel<DriverProfile> {
  protected readonly tableName = "carOwnerProfiles";
  protected readonly primaryKey = "userId";

  createProfile(input: CreateDriverProfileInput) {
    return this.insert({
      ...input,
      code: generateDriverCode(),
    } as unknown as Partial<DriverProfile>);
  }

  updateProfile(userId: string, input: UpdateDriverProfileInput) {
    return this.updateById(userId, input as unknown as Partial<DriverProfile>);
  }

  updateVerificationStatus(
    userId: string,
    status: "unverified" | "pending" | "approved" | "rejected" | "expiring",
  ) {
    return this.updateById(userId, {
      verificationStatus: status,
    } as unknown as Partial<DriverProfile>);
  }
}

export const driverProfileModel = new DriverProfileModel();
