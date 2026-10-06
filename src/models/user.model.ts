import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { authSessionModel } from "./authSession.model.js";
import { pushDeviceModel } from "./pushDevice.model.js";
import { notificationModel } from "./notification.model.js";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.schema.js";

export interface User {
  id: string;
  fullName: string | null;
  email: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  dateOfBirth: Date | null;
  passwordHash: string | null;
  passwordSalt: string | null;
  status: string;
  profilePicture: string | null;
  oauthProvider: string | null;
  role: string;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  isProfileComplete: boolean;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

type VerifiedFlags = Partial<Pick<User, "isPhoneVerified" | "isEmailVerified">>;

class UserModel extends BaseModel<User> {
  protected readonly tableName = "users";
  protected readonly excludedColumns = ["passwordHash", "passwordSalt"];

  // The verified flags are set by the server only (never from a request body): a phone that signed in with an
  // OTP is created verified, and changing an identifier resets its flag.
  createUser(input: CreateUserInput & VerifiedFlags) {
    return this.insert(input as unknown as Partial<User>);
  }

  updateUser(id: string, input: UpdateUserInput & VerifiedFlags) {
    return this.updateById(id, { ...input, updatedAt: new Date() } as unknown as Partial<User>);
  }

  markVerified(id: string, flags: VerifiedFlags) {
    return this.updateById(id, { ...flags, updatedAt: new Date() });
  }

  // Unlike findOne, keeps passwordHash — only for verifying a password, never for responses.
  findWithCredentials(criteria: Partial<User>): Promise<User | undefined> {
    return this.table.where(criteria).first();
  }

  // bcrypt embeds the salt in the hash, so passwordSalt is always cleared.
  setPassword(id: string, passwordHash: string) {
    return this.updateById(id, { passwordHash, passwordSalt: null, updatedAt: new Date() });
  }

  // Soft delete: the row (and its email/phone, which stay reserved) is kept; login, refresh and permission
  // checks all treat a set deletedAt as gone. The one way back is reactivate(), for a rider or driver who signs
  // up again with the same phone number.
  softDelete(id: string) {
    const now = new Date();
    return this.updateById(id, { deletedAt: now, updatedAt: now });
  }

  // A deleted rider or driver signing up again by phone: the same row (the number is unique) comes back as a
  // fresh account with the role they chose now. status is never touched — only an active row matches, so a
  // suspension can't be shed by deleting and re-registering. Every old session is revoked in the same
  // transaction, or a refresh token issued before the delete would work again. A recycled number may now
  // belong to someone else, so the driver side is reset too: no previous holder's Ghana card, address or
  // approval, documents that can't count towards a new approval, and no live commutes or vehicles. Wallet,
  // ledger and trips stay attached — the money belongs to the account.
  async reactivate(id: string, role: "rider" | "driver"): Promise<User | undefined> {
    return db.transaction(async (trx) => {
      const now = new Date();
      const [row] = await trx(this.tableName)
        .where({ id, status: "active" })
        .whereIn("role", ["rider", "driver"])
        .whereNotNull("deletedAt")
        .update({
          deletedAt: null,
          role,
          fullName: null,
          email: null,
          dateOfBirth: null,
          profilePicture: null,
          passwordHash: null,
          passwordSalt: null,
          oauthProvider: null,
          isPhoneVerified: true,
          isEmailVerified: false,
          isProfileComplete: false,
          lastActiveAt: null,
          updatedAt: now,
        })
        .returning("*");
      if (!row) {
        return undefined;
      }
      await authSessionModel.revokeAllForUser(id, trx);
      await pushDeviceModel.removeAllForUser(id, trx);
      await notificationModel.removeAllForUser(id, trx);
      await trx("carOwnerProfiles").where({ userId: id }).update({
        verificationStatus: "unverified",
        ghanaCardNumber: null,
        address: null,
        termsAcceptedAt: null,
        isOnline: false,
        autoAcceptBookings: false,
      });
      await trx("verificationDocuments")
        .where({ userId: id })
        .whereNull("deletedAt")
        .update({ deletedAt: now, updatedAt: now });
      await trx("driverCommutes").where({ userId: id }).update({ isActive: false, updatedAt: now });
      await trx("vehicles")
        .where({ carOwnerUserId: id })
        .update({ status: "retired", isVerified: false, verificationDate: null, updatedAt: now });
      return this.sanitize(row);
    });
  }

  // login/refresh/getMe all call assertAccountActive, which already checks status — this just sets it.
  setStatus(id: string, status: "active" | "suspended") {
    return this.updateById(id, { status, updatedAt: new Date() });
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.updateById(id, { lastActiveAt: new Date() });
  }

  // Riders and drivers only — admin accounts are a separate concern with their own permission module (see
  // MODULES), listed instead via GET /admin. Mirrors moduleFor() in user.controller.ts. Deleted accounts are
  // excluded here (unlike findById) — an admin browsing the list shouldn't see accounts that no longer
  // exist; one with the id already (e.g. from an activity log entry) can still look it up directly.
  async findAllRidersAndDrivers(): Promise<User[]> {
    const rows = await this.table
      .whereIn("role", ["rider", "driver"])
      .whereNull("deletedAt")
      .orderBy("createdAt", "desc");
    return rows.map((row: User) => this.sanitize(row));
  }
}

export const userModel = new UserModel();
