import { BaseModel } from "./BaseModel.js";
import {
  isValidSettingValue,
  type CreateSettingInput,
  type SettingType,
  type UpdateSettingInput,
} from "../schemas/setting.schema.js";
import {
  TRIP_SETTINGS,
  type TripSettingSpec,
  type TripSettingKey,
  type TripSettingValue,
} from "../config/tripSettings.js";

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

  // The stored value of each key, or its default when the setting is missing or its value doesn't match the
  // type or its bounds (min, max, oneOf). One query for all of them.
  async getValues<K extends TripSettingKey>(
    keys: readonly K[],
  ): Promise<{ [P in K]: TripSettingValue<P> }> {
    const rows: Pick<Setting, "key" | "value">[] = await this.table
      .whereIn("key", [...keys])
      .select("key", "value");
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    return Object.fromEntries(
      keys.map((key) => {
        const spec: TripSettingSpec = TRIP_SETTINGS[key];
        const value = stored.get(key);
        const valid =
          value !== undefined &&
          isValidSettingValue(spec.type, value) &&
          (spec.min === undefined || (value as number) >= spec.min) &&
          (spec.max === undefined || (value as number) <= spec.max) &&
          (spec.oneOf === undefined || spec.oneOf.includes(value as string));
        return [key, valid ? value : spec.default];
      }),
    ) as { [P in K]: TripSettingValue<P> };
  }

  async getValue<K extends TripSettingKey>(key: K): Promise<TripSettingValue<K>> {
    return (await this.getValues([key]))[key];
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
