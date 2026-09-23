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

class UserModel extends BaseModel<User> {
  protected readonly tableName = "users";
  protected readonly excludedColumns = ["passwordHash", "passwordSalt"];

  createUser(input: CreateUserInput) {
    return this.insert(input as unknown as Partial<User>);
  }

  updateUser(id: string, input: UpdateUserInput) {
    return this.updateById(id, { ...input, updatedAt: new Date() } as unknown as Partial<User>);
  }

  // Unlike findOne, keeps passwordHash — only for verifying a password, never for responses.
  findWithCredentials(criteria: Partial<User>): Promise<User | undefined> {
    return this.table.where(criteria).first();
  }

  // bcrypt embeds the salt in the hash, so passwordSalt is always cleared.
  setPassword(id: string, passwordHash: string) {
    return this.updateById(id, { passwordHash, passwordSalt: null, updatedAt: new Date() });
  }
}

export const userModel = new UserModel();
