import { z } from "zod";
import { userResponseSchema } from "./user.schema.js";
import { driverProfileResponseSchema } from "./driverProfile.schema.js";
import { riderProfileResponseSchema } from "./riderProfile.schema.js";
import { adminUserResponseSchema } from "./adminUser.schema.js";
import { passwordSchema } from "./common.schema.js";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginSchema>;

const phoneIdentifier = z.object({
  phoneCountryCode: z.string().min(1),
  phoneNumber: z.string().min(1),
  role: z.enum(["rider", "driver"]).optional(),
});

const emailIdentifier = z.object({
  email: z.email(),
});

export const requestOtpSchema = z.union([phoneIdentifier, emailIdentifier]);

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.union([
  phoneIdentifier.extend({ code: z.string().length(6) }),
  emailIdentifier.extend({ code: z.string().length(6) }),
]);

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: z.email(),
  code: z.string().length(6),
  newPassword: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const messageResponseSchema = z.object({
  message: z.string(),
});

export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const loginResponseSchema = authTokensResponseSchema.extend({
  user: userResponseSchema.extend({
    profile: z
      .union([driverProfileResponseSchema, riderProfileResponseSchema, adminUserResponseSchema])
      .nullable(),
  }),
});
