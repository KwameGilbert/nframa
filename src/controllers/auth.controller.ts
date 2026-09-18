import type { Request, Response } from "express";
import { userModel } from "../models/user.model.js";
import { adminUserModel } from "../models/adminUser.model.js";
import { otpCodeModel, OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS } from "../models/otpCode.model.js";
import { authSessionModel } from "../models/authSession.model.js";
import { sendSms } from "../services/sms.service.js";
import { sendEmail } from "../services/email.service.js";
import { generateOtpCode, hashOtpCode } from "../utils/otp.js";
import { generateRefreshToken, hashRefreshToken } from "../utils/refreshToken.js";
import { signAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess, sendNoContent } from "../utils/response.js";
import type { RequestOtpInput, VerifyOtpInput, RefreshTokenInput } from "../schemas/auth.schema.js";

const REFRESH_TOKEN_EXPIRES_IN_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? 30);

type Identifier = { phoneCountryCode: string; phoneNumber: string } | { email: string };

function toDbIdentifier(input: Identifier) {
  if ("email" in input) {
    return { identifier: input.email, channel: "email" as const };
  }
  return {
    identifier: `${input.phoneCountryCode}${input.phoneNumber}`,
    channel: "sms" as const,
  };
}

function toPurpose(role: string) {
  return `${role}Login`;
}

async function resolveOtpTarget(input: Identifier) {
  const { identifier, channel } = toDbIdentifier(input);

  const user =
    "email" in input
      ? await userModel.findOne({ email: input.email })
      : await userModel.findOne({
          phoneCountryCode: input.phoneCountryCode,
          phoneNumber: input.phoneNumber,
        });

  if (!user) {
    throw AppError.notFound("No account found for this identifier");
  }

  if (user.role === "admin") {
    const adminUser = await adminUserModel.findById(user.id);
    if (!adminUser || adminUser.status !== "active") {
      throw AppError.forbidden("Admin account is not active");
    }
  }

  return { user, identifier, channel };
}

function createSessionExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
}

async function issueTokens(userId: string, userType: "user" | "admin", role: string, req: Request) {
  const accessToken = await signAccessToken({ sub: userId, userType, role });

  const refreshToken = generateRefreshToken();
  await authSessionModel.createSession({
    userType,
    userId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? "0.0.0.0",
    expiresAt: createSessionExpiry(),
  });

  return { accessToken, refreshToken };
}

export async function requestOtp(req: Request, res: Response) {
  const input = req.validated.body as RequestOtpInput;
  const { user, identifier, channel } = await resolveOtpTarget(input);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await otpCodeModel.createOtp({
    identifier,
    channel,
    purpose: toPurpose(user.role),
    codeHash,
    expiresAt,
  });

  const message = `Your Nframa verification code is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`;

  if (channel === "sms") {
    await sendSms(identifier, message);
  } else {
    await sendEmail(identifier, "Your Nframa verification code", `<p>${message}</p>`);
  }

  sendSuccess(res, { message: "OTP sent" });
}

export async function verifyOtp(req: Request, res: Response) {
  const input = req.validated.body as VerifyOtpInput;
  const { user, identifier } = await resolveOtpTarget(input);

  const otp = await otpCodeModel.findLatestPending(identifier, toPurpose(user.role));

  if (!otp) {
    throw AppError.badRequest("No pending verification code for this identifier");
  }
  if (otp.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest("Verification code has expired");
  }
  if (otp.attemptCount >= OTP_MAX_ATTEMPTS) {
    throw AppError.badRequest("Too many attempts, request a new code");
  }
  if (otp.codeHash !== hashOtpCode(input.code)) {
    await otpCodeModel.incrementAttempts(otp.id);
    throw AppError.badRequest("Invalid verification code");
  }

  await otpCodeModel.markConsumed(otp.id);

  const userType = user.role === "admin" ? "admin" : "user";
  const tokens = await issueTokens(user.id, userType, user.role, req);

  sendSuccess(res, tokens);
}

export async function refreshSession(req: Request, res: Response) {
  const { refreshToken } = req.validated.body as RefreshTokenInput;
  const session = await authSessionModel.findActiveByTokenHash(hashRefreshToken(refreshToken));

  if (!session) {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  await authSessionModel.revoke(session.id);

  const user = await userModel.findById(session.userId);
  if (!user) {
    throw AppError.unauthorized("User no longer exists");
  }

  const tokens = await issueTokens(user.id, session.userType as "user" | "admin", user.role, req);

  sendSuccess(res, tokens);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.validated.body as RefreshTokenInput;
  const session = await authSessionModel.findActiveByTokenHash(hashRefreshToken(refreshToken));

  if (session) {
    await authSessionModel.revoke(session.id);
  }

  sendNoContent(res);
}
