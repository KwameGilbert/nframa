import { BaseModel } from "./BaseModel.js";
import type {
  CreateRolePermissionInput,
  UpdateRolePermissionInput,
} from "../schemas/rolePermission.schema.js";

export interface RolePermission {
  id: string;
  roleId: string;
  permission: Record<string, unknown>;
}

class RolePermissionModel extends BaseModel<RolePermission> {
  protected readonly tableName = "rolePermissions";

  createRolePermission(input: CreateRolePermissionInput) {
    return this.insert(input);
  }

  updateRolePermission(id: string, input: UpdateRolePermissionInput) {
    return this.updateById(id, input);
  }

  findByRoleId(roleId: string) {
    return this.findAllBy({ roleId });
  }
}

export const rolePermissionModel = new RolePermissionModel();
