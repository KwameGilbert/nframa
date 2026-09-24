import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import { rolePermissionModel } from "./rolePermission.model.js";
import type { PermissionMap } from "../config/permissions.js";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema.js";

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleWithPermissions extends Role {
  permissions: PermissionMap;
  assignedAdminsCount: number;
}

class RoleModel extends BaseModel<Role> {
  protected readonly tableName = "roles";

  // Soft-deleted admins are left out by default (they're not really "on" the role any more), but their admin
  // records still reference it — pass includeDeleted when that matters, e.g. before deleting the role.
  async countAssignedAdmins(
    roleIds: string[],
    { includeDeleted = false } = {},
  ): Promise<Map<string, number>> {
    if (roleIds.length === 0) {
      return new Map();
    }

    const query = db("adminUsers as a")
      .whereIn("a.roleId", roleIds)
      .groupBy("a.roleId")
      .select("a.roleId as roleId")
      .count("* as count");
    if (!includeDeleted) {
      query.join("users as u", "u.id", "a.userId").whereNull("u.deletedAt");
    }

    const rows = (await query) as unknown as { roleId: string; count: string }[];
    return new Map(rows.map((row) => [row.roleId, Number(row.count)]));
  }

  findForAdmin(userId: string): Promise<Role | undefined> {
    return db("roles as r")
      .join("adminUsers as a", "a.roleId", "r.id")
      .where("a.userId", userId)
      .first("r.*");
  }

  private async withPermissions(roles: Role[]): Promise<RoleWithPermissions[]> {
    const roleIds = roles.map((role) => role.id);
    const [permissions, counts] = await Promise.all([
      rolePermissionModel.findByRoles(roleIds),
      this.countAssignedAdmins(roleIds),
    ]);

    return roles.map((role) => ({
      ...role,
      permissions: permissions.get(role.id) ?? {},
      assignedAdminsCount: counts.get(role.id) ?? 0,
    }));
  }

  async listWithPermissions(): Promise<RoleWithPermissions[]> {
    const roles: Role[] = await this.table.orderBy("name");
    return this.withPermissions(roles);
  }

  async findWithPermissions(id: string): Promise<RoleWithPermissions | undefined> {
    const role = await this.findById(id);
    if (!role) {
      return undefined;
    }

    const [withPermissions] = await this.withPermissions([role]);
    return withPermissions;
  }

  // The role and its permissions are written in one transaction, so a failure leaves neither behind.
  async createWithPermissions({ permissions, ...fields }: CreateRoleInput) {
    let roleId: string;
    try {
      roleId = await db.transaction(async (trx) => {
        const [role] = (await trx(this.tableName).insert(fields).returning("id")) as {
          id: string;
        }[];
        await rolePermissionModel.replaceForRole(role.id, permissions, trx);
        return role.id;
      });
    } catch (err) {
      this.handleDbError(err);
    }

    return this.findWithPermissions(roleId);
  }

  // permissions, when given, replaces the role's whole permission set.
  async updateWithPermissions(id: string, { permissions, ...fields }: UpdateRoleInput) {
    try {
      await db.transaction(async (trx) => {
        if (Object.keys(fields).length > 0) {
          await trx(this.tableName)
            .where({ id })
            .update({ ...fields, updatedAt: new Date() });
        }
        if (permissions) {
          await rolePermissionModel.replaceForRole(id, permissions, trx);
        }
      });
    } catch (err) {
      this.handleDbError(err);
    }

    return this.findWithPermissions(id);
  }
}

export const roleModel = new RoleModel();
