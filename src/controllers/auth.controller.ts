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
import { logActivity, type Activity } from "../services/activityLog.service.js";
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

// Sign-in, session and password activity, filed against the account it concerns (when there is one) so
// an account's history includes attempts made on it. Verification codes are blanked out of the stored body.
function logAuthActivity(
  req: Request,
  activity: Omit<Activity, "module" | "targetType" | "redact">,
) {
  logActivity(req, {
    module: "auth",
    targetType: activity.targetId ? "user" : undefined,
    redact: ["code"],
    ...activity,
  });
}

// For .catch() on a password or code check: records the refusal, then passes the error on. Only refusals —
// an unexpected error isn't a failed attempt.
function recordRefusal(
  req: Request,
  activity: Pick<Activity, "action" | "description" | "targetId">,
) {
  return (err: unknown): never => {
    if (err instanceof AppError) {
      logAuthActivity(req, { ...activity, error: err.message });
    }
    throw err;
  };
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

  // A deleted rider or driver signing up again by phone re-registers: the row is reactivated on verify. A
  // suspended one isn't — it falls through to assertAccountActive and is refused like any inactive account.
  const reRegistering =
    !!user?.deletedAt && !("email" in input) && user.role !== "admin" && user.status === "active";

  if (user && !reRegistering) {
    await assertAccountActive(user);
    return { user, identifier, channel, role: user.role, isNewUser: false };
  }

  // No account yet — email never self-signs-up (admins are provisioned, not registered).
  if ("email" in input) {
    throw AppError.notFound("No account found for this identifier");
  }
  if (!input.role) {
    throw AppError.badRequest("role is required to sign up");
  }

  return { user, identifier, channel, role: input.role, isNewUser: true };
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

  return code;
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

  // Zero rows means a simultaneous request with the same code consumed it first — only one may use it.
  if ((await otpCodeModel.consumeAllPending(identifier, purpose)) === 0) {
    throw AppError.badRequest("No pending verification code for this identifier");
  }
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
    userModel.touchLastLogin(account.id),
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

// The account an email and password sign in to, once the password matches and the account is active.
async function checkPassword(user: User | undefined, password: string) {
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

  return account;
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.validated.body as LoginInput;
  const user = await userModel.findWithCredentials({ email });

  const account = await checkPassword(user, password).catch(
    recordRefusal(req, {
      action: "auth.login",
      description: "Failed to sign in with email and password",
      targetId: user?.id,
    }),
  );

  await completeLogin(account, req, res);

  logAuthActivity(req, {
    action: "auth.login",
    description: "Signed in with email and password",
    actorId: account.id,
    targetId: account.id,
  });
}

export async function requestLoginOtp(req: Request, res: Response) {
  const input = req.validated.body as RequestOtpInput;
  const { user, identifier, channel, role } = await resolveOtpTarget(input);

  const code = await sendOtp(identifier, channel, toPurpose(role), "verification code");

  const isDev = process.env.NODE_ENV === "development";
  sendSuccess(res, "Verification code sent", isDev ? { otp: code, code } : null);
  // Nobody has proven who they are yet, so there's no actor — only the account the code is for.
  logAuthActivity(req, {
    action: "auth.otp.request",
    description: "Requested a sign-in code",
    targetId: user?.id,
  });
}

export async function verifyLoginOtp(req: Request, res: Response) {
  const input = req.validated.body as VerifyOtpInput;
  // isNewUser: no account existed for this phone, or it belongs to a deleted rider/driver signing up again.
  const { user, identifier, role, isNewUser } = await resolveOtpTarget(input);

  await consumeOtp(identifier, toPurpose(role), input.code).catch(
    recordRefusal(req, {
      action: "auth.otp.verify",
      description: "Failed to sign in with a verification code",
      targetId: user?.id,
    }),
  );

  // Passing the OTP proves the person owns this phone, so it counts as verified from here on.
  let account = user;
  if (!("email" in input)) {
    if (!user) {
      account = await userModel.createUser({
        phoneCountryCode: input.phoneCountryCode,
        phoneNumber: input.phoneNumber,
        role: role as "rider" | "driver",
        isPhoneVerified: true,
      });
    } else if (isNewUser) {
      account = await userModel.reactivate(user.id, role as "rider" | "driver");
      // Only if the account was suspended after resolveOtpTarget checked it.
      if (!account) {
        throw AppError.forbidden("Account is not active");
      }
    } else if (!user.isPhoneVerified) {
      account = (await userModel.markVerified(user.id, { isPhoneVerified: true })) ?? user;
    }
  }
  if (!account) {
    throw AppError.notFound("No account found for this identifier");
  }

  await completeLogin(account, req, res, isNewUser);

  logAuthActivity(
    req,
    isNewUser
      ? {
          action: "auth.signup",
          description: user
            ? `Re-registered a deleted account as a ${account.role} with a verification code`
            : `Signed up as a ${account.role} with a verification code`,
          actorId: account.id,
          targetId: account.id,
          before: user,
          after: account,
        }
      : {
          action: "auth.otp.verify",
          description: "Signed in with a verification code",
          actorId: account.id,
          targetId: account.id,
        },
  );
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

  logAuthActivity(req, {
    action: "auth.refresh",
    description: "Refreshed session tokens",
    actorId: user.id,
    targetId: user.id,
  });
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.validated.body as RefreshTokenInput;
  const session = await authSessionModel.findActiveByTokenHash(hashRefreshToken(refreshToken));

  if (session) {
    await authSessionModel.revoke(session.id);
  }

  sendSuccess(res, "Logged out successfully");
  // Signing out with a token that's already dead changes nothing, so there's nothing to record.
  if (session) {
    logAuthActivity(req, {
      action: "auth.logout",
      description: "Signed out",
      actorId: session.userId,
      targetId: session.userId,
    });
  }
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
  // Anyone can ask for a code for any email, so there's no actor — only the account it's for, if any.
  logAuthActivity(req, {
    action: "auth.password.forgot",
    description: "Requested a password reset code",
    targetId: user?.id,
  });
}

export async function resetPassword(req: Request, res: Response) {
  const { email, code, newPassword } = req.validated.body as ResetPasswordInput;

  // No targetId on a refusal: looking the account up first would tell a wrong code apart from an unknown email.
  await consumeOtp(email, PASSWORD_RESET_PURPOSE, code).catch(
    recordRefusal(req, {
      action: "auth.password.reset",
      description: "Failed to reset a password with a reset code",
    }),
  );

  const user = await userModel.findOne({ email });
  if (!user) {
    throw AppError.notFound("No account found for this email");
  }

  await userModel.setPassword(user.id, await hashPassword(newPassword));
  await authSessionModel.revokeAllForUser(user.id);

  sendSuccess(res, "Password reset successfully. Sign in with your new password.");

  logAuthActivity(req, {
    action: "auth.password.reset",
    description: "Reset password with a reset code",
    actorId: user.id,
    targetId: user.id,
  });
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

  logAuthActivity(req, {
    action: "auth.password.change",
    description: "Changed password",
    targetId: credentials.id,
  });
}
