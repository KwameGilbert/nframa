import { registry } from "./registry.js";
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  authTokensResponseSchema,
  verifyOtpResponseSchema,
} from "../schemas/auth.schema.js";

registry.registerPath({
  method: "post",
  path: "/auth/otp/request",
  tags: ["Auth"],
  summary: "Request an OTP code for login or signup",
  description:
    "For phone identifiers, if no account exists yet, role is required and this becomes a signup attempt (the account is created on successful verify). Email identifiers are login-only — admin accounts are provisioned via POST /admin, never self-signed-up.",
  request: {
    body: {
      content: { "application/json": { schema: requestOtpSchema } },
    },
  },
  responses: {
    200: { description: "OTP sent" },
    400: { description: "Validation error, or role missing when signing up" },
    403: { description: "Admin account is not active" },
    404: { description: "No account found for this identifier (email identifiers only)" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/otp/verify",
  tags: ["Auth"],
  summary: "Verify an OTP code, creating the account first if this was a signup",
  description:
    "Returns the token pair along with the account, including its role-specific profile at user.profile (driver/rider/admin extension record). user.profile is null if the account hasn't completed that step yet (e.g. a brand-new signup with no driver profile created yet).",
  request: {
    body: {
      content: { "application/json": { schema: verifyOtpSchema } },
    },
  },
  responses: {
    200: {
      description: "Login or signup successful",
      content: { "application/json": { schema: verifyOtpResponseSchema } },
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
