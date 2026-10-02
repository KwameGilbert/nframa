import { z } from "zod";
import { phoneCountryCodeSchema } from "./common.schema.js";

const contactFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100).meta({ example: "Ama Mensah" }),
  phoneCountryCode: phoneCountryCodeSchema,
  phoneNumber: z.string().trim().min(9).max(15).meta({ example: "541436414" }),
  relationship: z.string().trim().min(1).max(50).meta({ example: "Sister" }),
});

export const createEmergencyContactSchema = contactFieldsSchema.extend({
  userId: z.uuid().optional().meta({
    description:
      "The rider or driver the contact is for. Defaults to the caller; anyone else needs users: create",
  }),
});

export type CreateEmergencyContactInput = z.infer<typeof createEmergencyContactSchema>;

export const updateEmergencyContactSchema = contactFieldsSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided" },
);

export type UpdateEmergencyContactInput = z.infer<typeof updateEmergencyContactSchema>;

export const listEmergencyContactsQuerySchema = z.object({
  userId: z.uuid().optional().meta({
    description: "Whose contacts to list. Defaults to the caller; anyone else needs users: read",
  }),
});

export type ListEmergencyContactsQuery = z.infer<typeof listEmergencyContactsQuerySchema>;

export const emergencyContactParamsSchema = z.object({
  id: z.uuid(),
});

export const emergencyContactResponseSchema = contactFieldsSchema.extend({
  id: z.uuid(),
  userId: z.uuid().meta({ description: "The user the contact belongs to" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
