import { BaseModel } from "./BaseModel.js";
import type { CreateAdminUserInput, UpdateAdminUserInput } from "../schemas/adminUser.schema.js";
import { userModel } from "./user.model.js";
import { roleModel } from "./role.model.js";

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

  async createAdminUser(input: CreateAdminUserInput) {
    const adminUser = await this.insert(input);
    return this.findByIdWithRelations(adminUser.userId);
  }

  async updateAdminUser(userId: string, input: UpdateAdminUserInput) {
    const adminUser = await this.updateById(userId, { ...input, updatedAt: new Date() });
    return adminUser && this.findByIdWithRelations(userId);
  }

  // Every "get admin(s)" endpoint (create, list, get, update, delete) returns this same shape — the admin
  // record plus its user and role (role includes that role's permissions, via roleModel.findWithPermissions,
  // the same shape GET /roles/:id returns) — so none of them special-case their payload against another's.
  // Permissions come from the role regardless of the admin's own status (invited/suspended), since this is
  // for display, not for enforcement (see authorize.ts for that).
  async findByIdWithRelations(userId: string) {
    const adminUser = await this.findById(userId);
    if (!adminUser) return null;

    const [user, role] = await Promise.all([
      userModel.findById(userId),
      roleModel.findWithPermissions(adminUser.roleId),
    ]);

    return { adminUser: { ...adminUser, user, role: role ?? null } };
  }

  // Deleted accounts are excluded here (unlike findByIdWithRelations, used directly by GET /admin/:userId) —
  // an admin browsing the list shouldn't see admins whose account no longer exists; one with the id already
  // can still look it up directly. The join also drops any orphaned admin row whose user row is gone entirely.
  async findAllWithRelations() {
    const adminUsers = await this.table
      .join("users", "users.id", "adminUsers.userId")
      .whereNull("users.deletedAt")
      .select("adminUsers.*")
      .orderBy("adminUsers.userId", "desc");
    return Promise.all(adminUsers.map((admin) => this.findByIdWithRelations(admin.userId)));
  }
}

export const adminUserModel = new AdminUserModel();
