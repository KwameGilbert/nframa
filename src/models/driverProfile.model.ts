import { randomBytes } from "node:crypto";
import { BaseModel } from "./BaseModel.js";
import type {
  CreateDriverProfileInput,
  UpdateDriverProfileInput,
} from "../schemas/driverProfile.schema.js";
import { userModel } from "./user.model.js";
import { vehicleModel } from "./vehicle.model.js";
import { verificationDocumentModel } from "./verificationDocument.model.js";

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

  async createProfile(input: CreateDriverProfileInput) {
    const profile = await this.insert({
      ...input,
      code: generateDriverCode(),
    } as unknown as Partial<DriverProfile>);
    // A brand-new profile has no vehicles or documents yet, but the response still matches every other
    // driver endpoint's shape (see findByIdWithRelations) rather than being a special case.
    return this.findByIdWithRelations(profile.userId);
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

  // Every "get driver(s)" endpoint returns the same shape — profile, user, vehicles, documents — built here
  // once and reused by the single-record lookups below, so none of them duplicate the joins. Deleted
  // accounts are excluded (unlike findByIdWithRelations, used directly by GET /driver/:userId) — an admin
  // browsing the list shouldn't see drivers whose account no longer exists; one with the id already can
  // still look it up directly. The join also drops any orphaned profile whose user row is gone entirely.
  async findAllDriversWithRelations() {
    const drivers = await this.table
      .join("users", "users.id", "carOwnerProfiles.userId")
      .whereNull("users.deletedAt")
      .select("carOwnerProfiles.*")
      .orderBy("carOwnerProfiles.userId", "desc");
    return Promise.all(drivers.map((driver) => this.findByIdWithRelations(driver.userId)));
  }

  async findByIdWithRelations(userId: string) {
    const profile = await this.findById(userId);
    if (!profile) return null;

    const [user, vehicles, documents] = await Promise.all([
      userModel.findById(userId),
      vehicleModel.findByUserId(userId),
      verificationDocumentModel.getDocumentsByUserId(userId),
    ]);

    return { driver: { ...profile, user, vehicles, documents } };
  }

  async findByCode(code: string) {
    const profile = await this.table.where({ code }).first();
    if (!profile) return null;

    return this.findByIdWithRelations(profile.userId);
  }

  async findByPhone(phoneCountryCode: string, phoneNumber: string) {
    const profile = await this.table
      .join("users", "users.id", "carOwnerProfiles.userId")
      .where({ phoneCountryCode, phoneNumber })
      .select("carOwnerProfiles.*")
      .first();

    if (!profile) return null;

    return this.findByIdWithRelations(profile.userId);
  }
}

export const driverProfileModel = new DriverProfileModel();
