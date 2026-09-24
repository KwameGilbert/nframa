import { z } from "zod";
import { userResponseSchema } from "./user.schema.js";
import { driverProfileResponseSchema } from "./driverProfile.schema.js";
import { riderProfileResponseSchema } from "./riderProfile.schema.js";
import { adminUserResponseSchema } from "./adminUser.schema.js";
import { permissionsSchema } from "./role.schema.js";
import { emailSchema, passwordSchema, phoneCountryCodeSchema } from "./common.schema.js";

const otpCodeSchema = z
  .string()
  .length(6)
  .meta({ description: "6-digit code from the SMS or email", example: "123456" });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6).meta({ example: "ChangeMe123!" }),
});

export type LoginInput = z.infer<typeof loginSchema>;

const phoneIdentifier = z.object({
  phoneCountryCode: phoneCountryCodeSchema,
  phoneNumber: z
    .string()
    .min(1)
    .meta({ description: "Phone number without the country code", example: "541436414" }),
  role: z.enum(["rider", "driver"]).optional().meta({
    description:
      "Required only when signing up a phone number that has no account yet; ignored for existing accounts",
  }),
});

const emailIdentifier = z.object({
  email: emailSchema,
});

export const requestOtpSchema = z.union([phoneIdentifier, emailIdentifier]);

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.union([
  phoneIdentifier.extend({ code: otpCodeSchema }),
  emailIdentifier.extend({ code: otpCodeSchema }),
]);

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).meta({
    description: "The refresh token from the latest login or refresh — each one works once",
    example: "q3J8b1xN0pZ4mW7tE2vY9cR5kL6hG1sD8fA3uQ0iO4nB7xT2eV5wC9zM1yK6jH3g",
  }),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  newPassword: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).meta({ example: "ChangeMe123!" }),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const messageResponseSchema = z.object({
  message: z.string().meta({ example: "OTP sent" }),
});

export const authTokensResponseSchema = z.object({
  accessToken: z.string().meta({
    description: "JWT for the Authorization: Bearer header; expires after 15 minutes",
    example: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3YzFlIiwidXNlclR5cGUiOiJhZG1pbiJ9.sig",
  }),
  refreshToken: z.string().meta({
    description: "Exchange at /auth/refresh for a new pair; valid 30 days, single use",
    example: "q3J8b1xN0pZ4mW7tE2vY9cR5kL6hG1sD8fA3uQ0iO4nB7xT2eV5wC9zM1yK6jH3g",
  }),
});

// The signed-in account as returned by login and GET /auth/me.
export const accountResponseSchema = userResponseSchema.extend({
  profile: z
    .union([driverProfileResponseSchema, riderProfileResponseSchema, adminUserResponseSchema])
    .nullable()
    .meta({
      description:
        "Role-specific record: driver profile, rider profile, or admin record. null until it's been created.",
    }),
  adminRole: z
    .object({
      id: z.uuid(),
      slug: z.string().meta({ example: "superadmin" }),
      name: z.string().meta({ example: "Super Admin" }),
      isSystem: z.boolean(),
    })
    .nullable()
    .meta({ description: "The admin's role; null for riders and drivers" }),
  permissions: permissionsSchema.meta({
    description:
      "What this account can do in the admin system, per module — use it to show/hide admin screens. {} for riders, drivers, and admins who aren't active.",
  }),
});

export const loginResponseSchema = authTokensResponseSchema.extend({
  user: accountResponseSchema,
});
