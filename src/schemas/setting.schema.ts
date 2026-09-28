import { z } from "zod";

export const SETTING_TYPES = ["string", "number", "boolean", "json"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const settingTypeSchema = z.enum(SETTING_TYPES).meta({
  description:
    "What value holds: string, number, boolean, or json (an object or array). Fixed once the setting is created.",
  example: "number",
});

const jsonValueSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

// What each type accepts. Used on create (against the type sent) and on update (against the stored type).
const valueSchemas: Record<SettingType, z.ZodType> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  json: jsonValueSchema,
};

export function isValidSettingValue(type: SettingType, value: unknown) {
  return valueSchemas[type].safeParse(value).success;
}

export function settingValueError(type: SettingType) {
  return type === "json"
    ? "Expected a JSON object or array for a json setting"
    : `Expected a ${type} for a ${type} setting`;
}

// Dotted segments group related settings (fares.baseFare, fares.perKmRate) without a separate category field.
export const settingKeySchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, {
    message:
      "Key must be camelCase segments separated by dots, each starting with a lowercase letter (e.g. fares.baseFare)",
  })
  .meta({
    description:
      "Unique key: camelCase segments separated by dots. Fixed once the setting is created.",
    example: "fares.baseFare",
  });

export const settingKeyParamsSchema = z.object({
  key: settingKeySchema,
});

export type SettingKeyParams = z.infer<typeof settingKeyParamsSchema>;

const valueSchema = z.unknown().meta({
  description:
    "Must match the setting's type: a string, a number, true/false, or a JSON object or array for json.",
  example: 5,
});

const descriptionSchema = z.string().min(1).nullable().meta({
  description: "What the setting controls",
  example: "Flat fee charged at the start of every trip, in GHS",
});

export const createSettingSchema = z
  .object({
    key: settingKeySchema,
    type: settingTypeSchema,
    value: valueSchema,
    description: descriptionSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!isValidSettingValue(data.type, data.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: settingValueError(data.type) });
    }
  });

export type CreateSettingInput = z.infer<typeof createSettingSchema>;

// The key and type can't change — delete and recreate the setting instead. value is checked against the
// stored type in the controller, since the type isn't known until the setting is loaded.
export const updateSettingSchema = z
  .object({
    value: valueSchema,
    description: descriptionSchema,
  })
  .partial()
  .refine((data) => data.value !== undefined || data.description !== undefined, {
    message: "At least one of value or description must be provided",
  });

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

export const settingResponseSchema = z.object({
  key: z.string().meta({ example: "fares.baseFare" }),
  type: settingTypeSchema,
  value: z
    .unknown()
    .meta({ description: "A string, number, boolean, or JSON object/array", example: 5 }),
  description: z
    .string()
    .nullable()
    .meta({ example: "Flat fee charged at the start of every trip, in GHS" }),
  updatedBy: z
    .uuid()
    .nullable()
    .meta({ description: "The user id of the admin who last created or changed the setting" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// GET /settings/:key embeds the setting's change history, read from the activity log (one entry per
// create/update/delete on this key) rather than a table of its own — logActivity already records before,
// after and who acted for every settings write, so a second history table would only duplicate it.
export const getSettingQuerySchema = z.object({
  historyLimit: z.coerce.number().int().min(1).max(100).default(20).meta({
    description: "How many of the most recent changes to return in history (1-100)",
    example: 20,
  }),
});

export type GetSettingQuery = z.infer<typeof getSettingQuerySchema>;

// Trimmed compared to an activity log's actor: a setting's history is readable with settings: read alone,
// so it names who changed it without also handing out that admin's email and phone number.
export const settingHistoryActorSchema = z
  .object({
    id: z.uuid(),
    fullName: z.string().nullable(),
    role: z.enum(["admin", "rider", "driver"]),
  })
  .meta({ description: "The account that made the change, as it is now" });

const snapshotSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .meta({ description: "The setting as this endpoint returns it" });

export const settingHistoryEntrySchema = z.object({
  id: z.uuid().meta({ description: "Id of the activity log entry this change was read from" }),
  action: z.string().meta({
    description: "setting.create, setting.update, or setting.delete",
    example: "setting.update",
  }),
  description: z.string().meta({ example: "Updated a setting" }),
  actor: settingHistoryActorSchema
    .nullable()
    .meta({ description: "Who made the change; null if their account has since been removed" }),
  before: snapshotSchema.meta({ description: "The setting before the change; null on creation" }),
  after: snapshotSchema.meta({ description: "The setting after the change; null on deletion" }),
  changedFields: z
    .array(z.string())
    .nullable()
    .meta({
      description:
        "Fields that differ between before and after (updatedAt is left out). Null for creations and deletions, where there's nothing to compare",
      example: ["value"],
    }),
  createdAt: z.iso.datetime().meta({ description: "When the change was made" }),
});

export const settingWithHistoryResponseSchema = settingResponseSchema.extend({
  history: z.array(settingHistoryEntrySchema).meta({
    description:
      "This setting's most recent changes, newest first, capped by historyLimit. Only changes that went through are recorded, so a refused attempt never appears here. Empty for a setting untouched since activity logging began",
  }),
});
