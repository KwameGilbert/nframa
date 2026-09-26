import type { Request, Response } from "express";
import { userModel, type User } from "../models/user.model.js";
import { adminUserModel } from "../models/adminUser.model.js";
import { roleModel } from "../models/role.model.js";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { riderProfileModel } from "../models/riderProfile.model.js";
import { otpCodeModel, OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS } from "../models/otpCode.model.js";
import { authSessionModel } from "../models/authSession.model.js";
import { sendSms } from "../services/sms.service.js";
import { sendEmail } from "../services/email.service.js";
import { generateOtpCode, hashOtpCode } from "../utils/otp.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateRefreshToken, hashRefreshToken } from "../utils/refreshToken.js";
import { signAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";
import type {
  LoginInput,
  RequestOtpInput,
  VerifyOtpInput,
  RefreshTokenInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from "../schemas/auth.schema.js";

const REFRESH_TOKEN_EXPIRES_IN_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? 30);
const PASSWORD_RESET_PURPOSE = "passwordReset";

type Identifier =
  { phoneCountryCode: string; phoneNumber: string; role?: "rider" | "driver" } | { email: string };

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

// Deleted is a soft delete (deletedAt set), so a found row isn't enough — it must also be undeleted and active.
async function assertAccountActive(user: User) {
  if (user.deletedAt || user.status !== "active") {
    throw AppError.forbidden("Account is not active");
  }

  if (user.role === "admin") {
    const adminUser = await adminUserModel.findById(user.id);
    if (!adminUser || adminUser.status !== "active") {
      throw AppError.forbidden("Admin account is not active");
    }
  }
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

  if (user) {
    await assertAccountActive(user);
    return { user, identifier, channel, role: user.role };
  }

  // No account yet — email never self-signs-up (admins are provisioned, not registered).
  if ("email" in input) {
    throw AppError.notFound("No account found for this identifier");
  }
  if (!input.role) {
    throw AppError.badRequest("role is required to sign up");
  }

  return { user: undefined, identifier, channel, role: input.role };
}

async function sendOtp(
  identifier: string,
  channel: "sms" | "email",
  purpose: string,
  label: string,
) {
  const code = generateOtpCode();

  await otpCodeModel.createOtp({
    identifier,
    channel,
    purpose,
    codeHash: hashOtpCode(code),
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
  });

  const message = `Your Nframa ${label} is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`;

  if (channel === "sms") {
    await sendSms(identifier, message);
  } else {
    await sendEmail(identifier, `Your Nframa ${label}`, `<p>${message}</p>`);
  }
}

async function consumeOtp(identifier: string, purpose: string, code: string) {
  const otp = await otpCodeModel.findLatestPending(identifier, purpose);

  if (!otp) {
    throw AppError.badRequest("No pending verification code for this identifier");
  }
  if (otp.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest("Verification code has expired");
  }
  if (otp.attemptCount >= OTP_MAX_ATTEMPTS) {
    throw AppError.badRequest("Too many attempts, request a new code");
  }
  if (otp.codeHash !== hashOtpCode(code)) {
    await otpCodeModel.incrementAttempts(otp.id);
    throw AppError.badRequest("Invalid verification code");
  }

  await otpCodeModel.consumeAllPending(identifier, purpose);
}

async function fetchProfile(account: User) {
  if (account.role === "rider") {
    return (await riderProfileModel.findById(account.id)) ?? null;
  }
  if (account.role === "driver") {
    return (await driverProfileModel.findById(account.id)) ?? null;
  }
  if (account.role === "admin") {
    return (await adminUserModel.findById(account.id)) ?? null;
  }
  return null;
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

// The admin's role and what it lets them do, so the admin app can show/hide screens without another request.
async function fetchAdminAccess(account: User) {
  if (account.role !== "admin") {
    return { adminRole: null, permissions: {} };
  }

  const adminUser = await adminUserModel.findById(account.id);
  const [role, permissions] = await Promise.all([
    adminUser ? roleModel.findById(adminUser.roleId) : undefined,
    rolePermissionModel.findForActiveAdmin(account.id),
  ]);

  return {
    adminRole: role
      ? { id: role.id, slug: role.slug, name: role.name, isSystem: role.isSystem }
      : null,
    permissions,
  };
}

// The account as login and GET /auth/me return it.
async function buildAccount(account: User) {
  const [profile, access] = await Promise.all([fetchProfile(account), fetchAdminAccess(account)]);
  return { ...account, profile, ...access };
}

async function completeLogin(account: User, req: Request, res: Response, isNewUser = false) {
  const userType = account.role === "admin" ? "admin" : "user";
  const [tokens, user] = await Promise.all([
    issueTokens(account.id, userType, account.role, req),
    buildAccount(account),
  ]);

  sendSuccess(res, "Login successful", { ...tokens, user, isNewUser });
}

export async function getMe(req: Request, res: Response) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  const account = await userModel.findById(req.auth.id);
  if (!account) {
    throw AppError.unauthorized("User no longer exists");
  }
  await assertAccountActive(account);

  sendSuccess(res, "Account retrieved successfully", await buildAccount(account));
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.validated.body as LoginInput;
  const user = await userModel.findWithCredentials({ email });

  if (!user?.passwordHash) {
    // Hash anyway so an unknown email takes as long to reject as a wrong password.
    await hashPassword(password);
    throw AppError.unauthorized("Invalid email or password");
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw AppError.unauthorized("Invalid email or password");
  }

  // Re-read through findById so the password columns are stripped before the account is returned.
  const account = await userModel.findById(user.id);
  if (!account) {
    throw AppError.unauthorized("Invalid email or password");
  }
  await assertAccountActive(account);

  await completeLogin(account, req, res);
}

export async function requestLoginOtp(req: Request, res: Response) {
  const input = req.validated.body as RequestOtpInput;
  const { identifier, channel, role } = await resolveOtpTarget(input);

  await sendOtp(identifier, channel, toPurpose(role), "verification code");

  sendSuccess(res, "Verification code sent");
}

export async function verifyLoginOtp(req: Request, res: Response) {
  const input = req.validated.body as VerifyOtpInput;
  const { user, identifier, role } = await resolveOtpTarget(input);
  const isNewUser = !user; // true only when no account existed yet for this identifier

  await consumeOtp(identifier, toPurpose(role), input.code);

  let account = user;
  if (!account && !("email" in input)) {
    account = await userModel.createUser({
      phoneCountryCode: input.phoneCountryCode,
      phoneNumber: input.phoneNumber,
      role: role as "rider" | "driver",
    });
  }
  if (!account) {
    throw AppError.notFound("No account found for this identifier");
  }

  await completeLogin(account, req, res, isNewUser);
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
  // The session is already revoked above, so a deactivated account is signed out here for good.
  await assertAccountActive(user);

  const tokens = await issueTokens(user.id, session.userType as "user" | "admin", user.role, req);

  sendSuccess(res, "Tokens refreshed successfully", tokens);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.validated.body as RefreshTokenInput;
  const session = await authSessionModel.findActiveByTokenHash(hashRefreshToken(refreshToken));

  if (session) {
    await authSessionModel.revoke(session.id);
  }

  sendSuccess(res, "Logged out successfully");
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.validated.body as ForgotPasswordInput;
  const user = await userModel.findOne({ email });

  // Same response either way, so this endpoint can't be used to discover which emails have accounts.
  // Not awaited for the same reason: waiting would make real accounts respond slower, and a delivery
  // failure would turn into a 500 only for emails that exist.
  if (user && !user.deletedAt) {
    sendOtp(email, "email", PASSWORD_RESET_PURPOSE, "password reset code").catch((err: unknown) => {
      req.log.child({ type: "error" }).error({ err }, "Failed to send password reset code");
    });
  }

  sendSuccess(res, "If an account exists for this email, a reset code has been sent");
}

export async function resetPassword(req: Request, res: Response) {
  const { email, code, newPassword } = req.validated.body as ResetPasswordInput;

  await consumeOtp(email, PASSWORD_RESET_PURPOSE, code);

  const user = await userModel.findOne({ email });
  if (!user) {
    throw AppError.notFound("No account found for this email");
  }

  await userModel.setPassword(user.id, await hashPassword(newPassword));
  await authSessionModel.revokeAllForUser(user.id);

  sendSuccess(res, "Password reset successfully. Sign in with your new password.");
}

export async function changePassword(req: Request, res: Response) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }
  const { currentPassword, newPassword } = req.validated.body as ChangePasswordInput;

  const credentials = await userModel.findWithCredentials({ id: req.auth.id });
  if (!credentials) {
    throw AppError.unauthorized("User no longer exists");
  }
  if (!credentials.passwordHash) {
    throw AppError.badRequest("This account has no password yet — use forgot password to set one");
  }
  if (!(await verifyPassword(currentPassword, credentials.passwordHash))) {
    throw AppError.badRequest("Current password is incorrect");
  }

  await userModel.setPassword(credentials.id, await hashPassword(newPassword));

  // Signs out every other device; the caller gets a fresh token pair so it stays signed in.
  await authSessionModel.revokeAllForUser(credentials.id);
  const tokens = await issueTokens(credentials.id, req.auth.userType, credentials.role, req);

  sendSuccess(res, "Password changed successfully", tokens);
}
