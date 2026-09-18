import { BaseModel } from "./BaseModel.js";
import type { CreateAdminUserInput, UpdateAdminUserInput } from "../schemas/adminUser.schema.js";

export interface AdminUser {
  userId: string;
  roleId: string;
  department: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

class AdminUserModel extends BaseModel<AdminUser> {
  protected readonly tableName = "adminUsers";
  protected readonly primaryKey = "userId";

  createAdminUser(input: CreateAdminUserInput) {
    return this.insert(input);
  }

  updateAdminUser(userId: string, input: UpdateAdminUserInput) {
    return this.updateById(userId, { ...input, updatedAt: new Date() });
  }
}

export const adminUserModel = new AdminUserModel();
