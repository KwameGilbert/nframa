import type { Knex } from "knex";
import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import {
  MODULES,
  type Module,
  type ModuleActions,
  type PermissionMap,
} from "../config/permissions.js";

// One row per role per module. The API speaks in PermissionMap ({ users: { create, read, ... } });
// these helpers translate between the two.
export interface RolePermissionRow {
  roleId: string;
  module: string;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toActions(row: RolePermissionRow): ModuleActions {
  return { create: row.canCreate, read: row.canRead, update: row.canUpdate, delete: row.canDelete };
}

function toRow(roleId: string, module: Module, actions: ModuleActions) {
  return {
    roleId,
    module,
    canCreate: actions.create,
    canRead: actions.read,
    canUpdate: actions.update,
    canDelete: actions.delete,
  };
}

function grantsAnything(actions: ModuleActions) {
  return actions.create || actions.read || actions.update || actions.delete;
}

function toPermissionMap(rows: RolePermissionRow[]): PermissionMap {
  const permissions: PermissionMap = {};
  for (const row of rows) {
    // Rows for a module that's since been removed from MODULES are ignored rather than leaking into responses.
    if ((MODULES as readonly string[]).includes(row.module)) {
      permissions[row.module as Module] = toActions(row);
    }
  }
  return permissions;
}

class RolePermissionModel extends BaseModel<RolePermissionRow> {
  protected readonly tableName = "rolePermissions";

  async findByRole(roleId: string): Promise<PermissionMap> {
    return toPermissionMap(await this.table.where({ roleId }));
  }

  async findByRoles(roleIds: string[]): Promise<Map<string, PermissionMap>> {
    const rows: RolePermissionRow[] =
      roleIds.length > 0 ? await this.table.whereIn("roleId", roleIds) : [];

    return new Map(
      roleIds.map((roleId) => [
        roleId,
        toPermissionMap(rows.filter((row) => row.roleId === roleId)),
      ]),
    );
  }

  // Only an admin who may act right now gets permissions: user row active and not soft-deleted, admin record
  // active. So suspending an admin cuts their access on their next request, not when their token expires.
  async findForActiveAdmin(userId: string): Promise<PermissionMap> {
    const rows: RolePermissionRow[] = await db("rolePermissions as rp")
      .join("adminUsers as a", "a.roleId", "rp.roleId")
      .join("users as u", "u.id", "a.userId")
      .where({ "a.userId": userId, "a.status": "active", "u.status": "active" })
      .whereNull("u.deletedAt")
      .select("rp.*");

    return toPermissionMap(rows);
  }

  // Replaces the role's whole permission set. Modules with every action false are dropped, not stored.
  async replaceForRole(roleId: string, permissions: PermissionMap, trx: Knex.Transaction) {
    await trx(this.tableName).where({ roleId }).del();

    const rows = Object.entries(permissions)
      .filter((entry): entry is [Module, ModuleActions] => !!entry[1] && grantsAnything(entry[1]))
      .map(([module, actions]) => toRow(roleId, module, actions));

    if (rows.length > 0) {
      await trx(this.tableName).insert(rows);
    }
  }

  async setModule(roleId: string, module: Module, actions: ModuleActions) {
    if (!grantsAnything(actions)) {
      await this.removeModule(roleId, module);
      return;
    }

    const row = toRow(roleId, module, actions);
    await this.table
      .insert(row)
      .onConflict(["roleId", "module"])
      .merge({ ...row, updatedAt: new Date() });
  }

  removeModule(roleId: string, module: Module) {
    return this.table.where({ roleId, module }).del();
  }
}

export const rolePermissionModel = new RolePermissionModel();
