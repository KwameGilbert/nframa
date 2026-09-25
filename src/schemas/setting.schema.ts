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
