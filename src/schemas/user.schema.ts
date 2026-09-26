import { z } from "zod";
import { emailSchema, idParamsSchema, phoneCountryCodeSchema } from "./common.schema.js";

const fullNameSchema = z.string().min(1).meta({ example: "Ama Mensah" });

export const createUserSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional().meta({ description: "Required for admin accounts" }),
    phoneCountryCode: phoneCountryCodeSchema
      .optional()
      .meta({ description: "Required for rider/driver accounts" }),
    phoneNumber: z.string().min(1).optional().meta({
      description: "Without the country code. Required for rider/driver accounts",
      example: "541436414",
    }),
    role: z.enum(["rider", "driver", "admin"]),
  })
  .refine((data) => data.role === "admin" || (data.phoneCountryCode && data.phoneNumber), {
    message: "Phone country code and phone number are required for rider/driver accounts",
    path: ["phoneNumber"],
  })
  .refine((data) => data.role !== "admin" || data.email, {
    message: "email is required for admin accounts",
    path: ["email"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    phoneCountryCode: phoneCountryCodeSchema,
    phoneNumber: z.string().min(9).meta({ example: "541436414" }),
    dateOfBirth: z.iso.date().meta({ example: "1995-04-12" }),
    profilePicture: z.string().min(1).meta({ example: "https://cdn.nframa.com/avatars/ama.jpg" }),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userIdParamsSchema = idParamsSchema;

export const userResponseSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable().meta({ example: "Ama Mensah" }),
  email: z.string().nullable().meta({ example: "admin@nframa.com" }),
  phoneCountryCode: z.string().nullable().meta({ example: "+233" }),
  phoneNumber: z.string().nullable().meta({ example: "541436414" }),
  dateOfBirth: z.iso.date().nullable().meta({ example: "1995-04-12" }),
  status: z.enum(["active", "suspended"]).meta({
    description: "active: account is usable; suspended: account is locked out",
    example: "active",
  }),
  profilePicture: z.string().nullable().meta({ example: "https://cdn.nframa.com/avatars/ama.jpg" }),
  oauthProvider: z.enum(["google", "facebook", "apple"]).nullable().meta({
    description: "OAuth provider if the account was created via social login",
    example: "google",
  }),
  role: z.enum(["rider", "driver", "admin"]).meta({
    description: "rider: customer; driver: service provider; admin: platform staff",
    example: "rider",
  }),
  isPhoneVerified: z.boolean(),
  isEmailVerified: z.boolean(),
  isProfileComplete: z.boolean(),
  lastActiveAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "Set when the account is soft-deleted" }),
});
