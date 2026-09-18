import { registry } from "./registry.js";
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  authTokensResponseSchema,
} from "../schemas/auth.schema.js";

registry.registerPath({
  method: "post",
  path: "/auth/otp/request",
  tags: ["Auth"],
  summary: "Request an OTP code for login",
  request: {
    body: {
      content: { "application/json": { schema: requestOtpSchema } },
    },
  },
  responses: {
    200: { description: "OTP sent" },
    400: { description: "Validation error" },
    403: { description: "Admin account is not active" },
    404: { description: "No account found for this identifier" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/otp/verify",
  tags: ["Auth"],
  summary: "Verify an OTP code and receive tokens",
  request: {
    body: {
      content: { "application/json": { schema: verifyOtpSchema } },
    },
  },
  responses: {
    200: {
      description: "Login successful",
      content: { "application/json": { schema: authTokensResponseSchema } },
    },
    400: { description: "Validation error, expired, or invalid code" },
    403: { description: "Admin account is not active" },
    404: { description: "No account found for this identifier" },
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
