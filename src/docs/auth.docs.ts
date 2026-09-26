import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  loginSchema,
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  authTokensResponseSchema,
  loginResponseSchema,
  accountResponseSchema,
} from "../schemas/auth.schema.js";

const loginResponseDescription =
  "Returns the token pair along with the account, including its role-specific profile at user.profile (driver/rider/admin extension record). user.profile is null if the account hasn't completed that step yet (e.g. a brand-new signup with no driver profile created yet). For admins, user.adminRole and user.permissions say what they can access. isNewUser is true only when this call just created the account (phone OTP signup); it's always false for password login and email-OTP login.";

const accountBlocked = errorResponse(
  "Account is suspended or deleted, or the admin account is not active",
);

registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  summary: "Log in with email and password",
  description: `Works for any account that has a password set — admins get one at provisioning (POST /admin) or via /auth/password/forgot. Rate limited to 10 failed attempts per email per 15 minutes. ${loginResponseDescription}`,
  request: {
    body: {
      content: { "application/json": { schema: loginSchema } },
    },
  },
  responses: {
    200: successResponse("Login successful", loginResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Invalid email or password"),
    403: accountBlocked,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/login/otp",
  tags: ["Auth"],
  summary: "Send a login OTP code (step 1 of OTP login)",
  description:
    "For phone identifiers, if no account exists yet, role is required and this becomes a signup attempt (the account is created on successful verify). Email identifiers are login-only — admin accounts are provisioned via POST /admin, never self-signed-up. The code expires after 5 minutes. Rate limited to 5 codes per phone/email per 15 minutes.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: requestOtpSchema,
          examples: {
            phoneSignup: {
              summary: "Phone — new account (role required)",
              value: { phoneCountryCode: "+233", phoneNumber: "541436414", role: "rider" },
            },
            phoneLogin: {
              summary: "Phone — existing account",
              value: { phoneCountryCode: "+233", phoneNumber: "541436414" },
            },
            adminEmail: {
              summary: "Email — admin login",
              value: { email: "admin@nframa.com" },
            },
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Verification code sent"),
    400: errorResponse("Validation error, or role missing when signing up"),
    403: accountBlocked,
    404: errorResponse("No account found for this identifier (email identifiers only)"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/login/verify",
  tags: ["Auth"],
  summary: "Verify a login OTP code and get tokens (step 2 of OTP login)",
  description: `Send the same identifier used for /auth/login/otp, plus the code. Creates the account first if this was a phone signup. Each code allows 5 wrong attempts; rate limited to 10 failed attempts per phone/email per 15 minutes. ${loginResponseDescription}`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: verifyOtpSchema,
          examples: {
            phoneSignup: {
              summary: "Phone — new account (role required)",
              value: {
                phoneCountryCode: "+233",
                phoneNumber: "541436414",
                role: "rider",
                code: "123456",
              },
            },
            phoneLogin: {
              summary: "Phone — existing account",
              value: { phoneCountryCode: "+233", phoneNumber: "541436414", code: "123456" },
            },
            adminEmail: {
              summary: "Email — admin login",
              value: { email: "admin@nframa.com", code: "123456" },
            },
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Login successful", loginResponseSchema),
    400: errorResponse(
      "Validation error, or the code is missing, expired, wrong, or out of attempts",
    ),
    403: accountBlocked,
    404: errorResponse("No account found for this identifier (email identifiers only)"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  tags: ["Auth"],
  summary: "Exchange a refresh token for a new access/refresh token pair",
  description:
    "The refresh token sent is revoked — store the new pair. Rate limited to 300 requests per IP per 15 minutes.",
  request: {
    body: {
      content: { "application/json": { schema: refreshTokenSchema } },
    },
  },
  responses: {
    200: successResponse("Tokens refreshed successfully", authTokensResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Invalid, expired, or already-used refresh token"),
    403: errorResponse(
      "Account is suspended or deleted, or the admin account is not active — the session is revoked",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  tags: ["Auth"],
  summary: "Get the signed-in account",
  description:
    "Same account shape as login returns (profile, and for admins adminRole + permissions) — use it to refresh the admin app's view of what the user can do after roles change.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Account retrieved successfully", accountResponseSchema),
    401: errorResponse("Missing or invalid access token, or the user no longer exists"),
    403: accountBlocked,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  summary: "Revoke a refresh token session",
  description: "Always 204, even if the refresh token was already invalid.",
  request: {
    body: {
      content: { "application/json": { schema: refreshTokenSchema } },
    },
  },
  responses: {
    200: successResponse("Logged out successfully"),
    400: errorResponse("Validation error"),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/forgot",
  tags: ["Auth"],
  summary: "Email a password reset code",
  description:
    "Always responds 200 whether or not the email has an account, so it can't be used to discover accounts. Also how a provisioned admin without a password sets their first one. The code expires after 5 minutes. Rate limited to 5 requests per email per 15 minutes.",
  request: {
    body: {
      content: { "application/json": { schema: forgotPasswordSchema } },
    },
  },
  responses: {
    200: successResponse("If an account exists for this email, a reset code has been sent"),
    400: errorResponse("Validation error"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/reset",
  tags: ["Auth"],
  summary: "Set a new password using the emailed reset code",
  description:
    "Signs the account out of every session; log in again with the new password. Rate limited to 10 failed attempts per email per 15 minutes.",
  request: {
    body: {
      content: { "application/json": { schema: resetPasswordSchema } },
    },
  },
  responses: {
    200: successResponse("Password reset successfully. Sign in with your new password."),
    400: errorResponse(
      "Validation error, or the code is missing, expired, wrong, or out of attempts",
    ),
    404: errorResponse("No account found for this email"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/change",
  tags: ["Auth"],
  summary: "Change the signed-in account's password",
  description:
    "Signs out every other session and returns a fresh token pair — replace the stored tokens with these. Rate limited to 5 failed attempts per account per 15 minutes.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: successResponse("Password changed successfully", authTokensResponseSchema),
    400: errorResponse(
      "Validation error, current password incorrect, or the account has no password yet",
    ),
    401: errorResponse("Missing or invalid access token, or the user no longer exists"),
    429: rateLimitedResponse,
  },
});
