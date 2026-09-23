import { registry } from "./registry.js";
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
  messageResponseSchema,
} from "../schemas/auth.schema.js";

const loginResponseDescription =
  "Returns the token pair along with the account, including its role-specific profile at user.profile (driver/rider/admin extension record). user.profile is null if the account hasn't completed that step yet (e.g. a brand-new signup with no driver profile created yet).";

registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  summary: "Log in with email and password",
  description: `Only accounts that have a password set can use this — admins get one at provisioning (POST /admin) or via /auth/password/forgot. ${loginResponseDescription}`,
  request: {
    body: {
      content: { "application/json": { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      description: "Login successful",
      content: { "application/json": { schema: loginResponseSchema } },
    },
    400: { description: "Validation error" },
    401: { description: "Invalid email or password" },
    403: { description: "Admin account is not active" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/login/otp",
  tags: ["Auth"],
  summary: "Send a login OTP code (step 1 of OTP login)",
  description:
    "For phone identifiers, if no account exists yet, role is required and this becomes a signup attempt (the account is created on successful verify). Email identifiers are login-only — admin accounts are provisioned via POST /admin, never self-signed-up.",
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
    200: {
      description: "OTP sent",
      content: { "application/json": { schema: messageResponseSchema } },
    },
    400: { description: "Validation error, or role missing when signing up" },
    403: { description: "Admin account is not active" },
    404: { description: "No account found for this identifier (email identifiers only)" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/login/verify",
  tags: ["Auth"],
  summary: "Verify a login OTP code and get tokens (step 2 of OTP login)",
  description: `Send the same identifier used for /auth/login/otp, plus the code. Creates the account first if this was a phone signup. ${loginResponseDescription}`,
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
    200: {
      description: "Login or signup successful",
      content: { "application/json": { schema: loginResponseSchema } },
    },
    400: { description: "Validation error, expired, or invalid code" },
    403: { description: "Admin account is not active" },
    404: { description: "No account found for this identifier (email identifiers only)" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  tags: ["Auth"],
  summary: "Exchange a refresh token for a new access/refresh token pair",
  request: {
    body: {
      content: { "application/json": { schema: refreshTokenSchema } },
    },
  },
  responses: {
    200: {
      description: "New tokens issued",
      content: { "application/json": { schema: authTokensResponseSchema } },
    },
    400: { description: "Validation error" },
    401: { description: "Invalid or expired refresh token" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  summary: "Revoke a refresh token session",
  request: {
    body: {
      content: { "application/json": { schema: refreshTokenSchema } },
    },
  },
  responses: {
    204: { description: "Logged out" },
    400: { description: "Validation error" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/forgot",
  tags: ["Auth"],
  summary: "Email a password reset code",
  description:
    "Always responds 200 whether or not the email has an account, so it can't be used to discover accounts. Also how a provisioned admin without a password sets their first one.",
  request: {
    body: {
      content: { "application/json": { schema: forgotPasswordSchema } },
    },
  },
  responses: {
    200: {
      description: "Reset code sent (if the account exists)",
      content: { "application/json": { schema: messageResponseSchema } },
    },
    400: { description: "Validation error" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/reset",
  tags: ["Auth"],
  summary: "Set a new password using the emailed reset code",
  description: "Signs the account out of every session; log in again with the new password.",
  request: {
    body: {
      content: { "application/json": { schema: resetPasswordSchema } },
    },
  },
  responses: {
    200: {
      description: "Password reset",
      content: { "application/json": { schema: messageResponseSchema } },
    },
    400: { description: "Validation error, expired, or invalid code" },
    404: { description: "No account found for this email" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/change",
  tags: ["Auth"],
  summary: "Change the signed-in account's password",
  description:
    "Signs out every other session and returns a fresh token pair — replace the stored tokens with these.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: {
      description: "Password changed; new tokens issued",
      content: { "application/json": { schema: authTokensResponseSchema } },
    },
    400: {
      description:
        "Validation error, current password incorrect, or the account has no password yet",
    },
    401: { description: "Missing or invalid access token" },
  },
});
