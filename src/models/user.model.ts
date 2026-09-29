import { BaseModel } from "./BaseModel.js";
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
  // checks all treat a set deletedAt as gone.
  softDelete(id: string) {
    const now = new Date();
    return this.updateById(id, { deletedAt: now, updatedAt: now });
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
