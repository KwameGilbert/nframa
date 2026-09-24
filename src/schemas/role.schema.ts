import { z } from "zod";

const slugSchema = z
  .string()
  .min(1)
  .meta({ description: "Unique machine-readable identifier", example: "ops-admin" });
const nameSchema = z
  .string()
  .min(1)
  .meta({ description: "Unique display name", example: "Ops Admin" });
const descriptionSchema = z.string().min(1).meta({ example: "Operations admin" });

export const createRoleSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    slug: slugSchema,
    name: nameSchema,
    description: descriptionSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const roleResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string().meta({ example: "ops-admin" }),
  name: z.string().meta({ example: "Ops Admin" }),
  description: z.string().meta({ example: "Operations admin" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
