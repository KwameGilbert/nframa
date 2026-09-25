import { BaseModel } from "./BaseModel.js";
import type {
  CreateSettingInput,
  SettingType,
  UpdateSettingInput,
} from "../schemas/setting.schema.js";

export interface Setting {
  key: string;
  type: SettingType;
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// value is a jsonb column, so it's written JSON-encoded: pg would otherwise send a string as raw text and an
// array as a Postgres array literal, neither of which is valid JSON. Reads come back already parsed.
class SettingModel extends BaseModel<Setting> {
  protected readonly tableName = "settings";
  protected readonly primaryKey = "key";

  list(): Promise<Setting[]> {
    return this.table.orderBy("key");
  }

  createSetting({ value, ...fields }: CreateSettingInput, updatedBy: string) {
    return this.insert({ ...fields, value: JSON.stringify(value), updatedBy });
  }

  updateSetting(key: string, { value, ...fields }: UpdateSettingInput, updatedBy: string) {
    return this.updateById(key, {
      ...fields,
      ...(value !== undefined && { value: JSON.stringify(value) }),
      updatedBy,
      updatedAt: new Date(),
    });
  }
}

export const settingModel = new SettingModel();
