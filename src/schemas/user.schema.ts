import { z } from "zod";
import { emergencyContactResponseSchema } from "./emergencyContact.schema.js";
import { emailSchema, idParamsSchema, phoneCountryCodeSchema } from "./common.schema.js";

const fullNameSchema = z.string().min(1).meta({ example: "Ama Mensah" });

const userStatusSchema = z.enum(["active", "suspended"]).meta({
  description: "active: account is usable; suspended: locked out of sign-in and session refresh",
  example: "active",
});

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

// Mirrors updateDriverProfileSchema's fields (driverProfile.schema.ts) without importing it — that schema
// already imports from this file (for driverWithRelationsResponseSchema's nested user), so importing it back
// here would cycle. Only meaningful when the target account's role is driver (checked in the controller,
// since the target isn't known until it's loaded); riders have no editable profile fields today.
const driverProfileFieldsSchema = z
  .object({
    ghanaCardNumber: z.string().min(1).meta({ example: "GHA-123456789-0" }),
    address: z.string().min(1).meta({ example: "12 Oxford St, Osu, Accra" }),
    isOnline: z.boolean(),
    autoAcceptBookings: z.boolean(),
  })
  .partial();

export const updateUserSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    phoneCountryCode: phoneCountryCodeSchema,
    phoneNumber: z.string().min(9).meta({ example: "541436414" }),
    dateOfBirth: z.iso.date().meta({ example: "1995-04-12" }),
    profilePicture: z.string().min(1).meta({
      description:
        "Profile picture URL, or file upload (multipart form field 'profilePicture'), or base64-encoded image (data:image/png;base64,... or raw base64). Files uploaded to cloud storage; URL is stored.",
      example: "https://cdn.nframa.com/avatars/ama.jpg",
    }),
    profile: driverProfileFieldsSchema.meta({
      description:
        "Driver-specific fields (ghanaCardNumber, address, isOnline, autoAcceptBookings) — only valid when the target account's role is driver. Saved atomically with the personal fields above, in the same transaction.",
    }),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateUserStatusSchema = z.object({
  status: userStatusSchema,
  reason: z.string().min(1).optional().meta({
    description: "Why the status is changing — kept on the status history record",
    example: "Repeated ride cancellations",
  }),
  notes: z.string().min(1).optional().meta({
    description: "Internal admin-only notes, not shown to the account holder",
    example: "Third warning this month, see ticket #482",
  }),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const userIdParamsSchema = idParamsSchema;

export const userStatusHistoryResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  previousStatus: userStatusSchema,
  newStatus: userStatusSchema,
  reason: z.string().nullable(),
  notes: z.string().nullable().meta({ description: "Internal admin-only notes" }),
  changedBy: z.uuid().nullable().meta({ description: "The admin who made the change" }),
  changedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const userResponseSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable().meta({ example: "Ama Mensah" }),
  email: z.string().nullable().meta({ example: "admin@nframa.com" }),
  phoneCountryCode: z.string().nullable().meta({ example: "+233" }),
  phoneNumber: z.string().nullable().meta({ example: "541436414" }),
  dateOfBirth: z.iso.date().nullable().meta({ example: "1995-04-12" }),
  status: userStatusSchema,
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

// GET /users/:id only — not the base userResponseSchema, so login, GET /auth/me, GET /users (list), and the
// nested user field on driver/rider/admin responses don't all carry these extra queries along for the ride.
export const userDetailResponseSchema = userResponseSchema.extend({
  statusHistory: z.array(userStatusHistoryResponseSchema).meta({
    description:
      "Every suspend/reactivate transition, newest first. When the account holder is viewing their own record, each entry's notes is null — notes is staff-only; an admin viewing someone else's account sees it as recorded.",
  }),
  emergencyContacts: z.array(emergencyContactResponseSchema).meta({
    description: "The user's emergency contacts, oldest first. Empty when they have none.",
  }),
});
