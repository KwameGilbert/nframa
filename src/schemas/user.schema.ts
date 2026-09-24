import { z } from "zod";
import { idParamsSchema } from "./common.schema.js";

export const createUserSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    email: z.email().optional(),
    phoneCountryCode: z.string().min(1).optional(),
    phoneNumber: z.string().min(1).optional(),
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
    fullName: z.string().min(1),
    email: z.email(),
    phoneCountryCode: z.string().min(1),
    phoneNumber: z.string().min(9),
    dateOfBirth: z.iso.date(),
    profilePicture: z.string().min(1),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userIdParamsSchema = idParamsSchema;

export const userResponseSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phoneCountryCode: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  dateOfBirth: z.iso.date().nullable(),
  status: z.string(),
  profilePicture: z.string().nullable(),
  oauthProvider: z.string().nullable(),
  role: z.enum(["rider", "driver", "admin"]),
  isPhoneVerified: z.boolean(),
  isEmailVerified: z.boolean(),
  isProfileComplete: z.boolean(),
  lastActiveAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
