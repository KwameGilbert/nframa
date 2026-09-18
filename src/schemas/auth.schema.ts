import { z } from "zod";

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

export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
