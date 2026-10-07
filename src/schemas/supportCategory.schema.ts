import { z } from "zod";

export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_AUDIENCES = ["all", "rider", "driver"] as const;

export const supportPrioritySchema = z.enum(SUPPORT_PRIORITIES).meta({
  description: "How urgently staff should pick a ticket up. Only staff see or set it",
  example: "normal",
});

const nameSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .meta({ description: "Shown to users; unique, ignoring case", example: "Lost item" });
const descriptionSchema = z.string().trim().max(300).nullable().meta({
  description: "One line shown under the name",
  example: "You left something in a vehicle.",
});
const audienceSchema = z.enum(SUPPORT_AUDIENCES).meta({
  description: "Who can pick it: everyone, riders only or drivers only",
  example: "all",
});
const isActiveSchema = z.boolean().meta({
  description: "Inactive categories are hidden from users; their existing tickets keep them",
});
const sortOrderSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .meta({ description: "Lower comes first", example: 70 });

export const createSupportCategorySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  audience: audienceSchema.default("all"),
  defaultPriority: supportPrioritySchema.default("normal"),
  isActive: isActiveSchema.default(true),
  sortOrder: sortOrderSchema.default(0),
});

export type CreateSupportCategoryInput = z.infer<typeof createSupportCategorySchema>;

export const updateSupportCategorySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    audience: audienceSchema,
    defaultPriority: supportPrioritySchema,
    isActive: isActiveSchema,
    sortOrder: sortOrderSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateSupportCategoryInput = z.infer<typeof updateSupportCategorySchema>;

export const supportCategoryResponseSchema = z.object({
  id: z.uuid(),
  name: z.string().meta({ example: "Lost item" }),
  description: z.string().nullable().meta({ example: "You left something in a vehicle." }),
});

export const adminSupportCategoryResponseSchema = supportCategoryResponseSchema.extend({
  audience: z.enum(SUPPORT_AUDIENCES),
  defaultPriority: z.enum(SUPPORT_PRIORITIES).meta({
    description: "The priority a new ticket in this category starts with",
  }),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  ticketCount: z.number().int().meta({
    description: "Tickets filed under it, any status; a category with any can't be deleted",
    example: 12,
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
