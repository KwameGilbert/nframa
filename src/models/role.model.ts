import { BaseModel } from "./BaseModel.js";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema.js";

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

class RoleModel extends BaseModel<Role> {
  protected readonly tableName = "roles";

  createRole(input: CreateRoleInput) {
    return this.insert(input);
  }

  updateRole(id: string, input: UpdateRoleInput) {
    return this.updateById(id, { ...input, updatedAt: new Date() });
  }
}

export const roleModel = new RoleModel();
