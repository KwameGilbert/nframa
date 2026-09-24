import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import {
  authIpLimit,
  refreshIpLimit,
  loginLimit,
  otpSendLimit,
  otpVerifyLimit,
  passwordForgotLimit,
  passwordResetLimit,
  passwordChangeLimit,
} from "../middlewares/rateLimit.js";
import {
  loginSchema,
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "../schemas/auth.schema.js";
import {
  login,
  requestLoginOtp,
  verifyLoginOtp,
  refreshSession,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

// Per-account limiters read the validated body, so they sit after validate().
authRouter.post("/auth/login", authIpLimit, validate({ body: loginSchema }), loginLimit, login);
authRouter.post(
  "/auth/login/otp",
  authIpLimit,
  validate({ body: requestOtpSchema }),
  otpSendLimit,
  requestLoginOtp,
);
authRouter.post(
  "/auth/login/verify",
  authIpLimit,
  validate({ body: verifyOtpSchema }),
  otpVerifyLimit,
  verifyLoginOtp,
);
authRouter.post(
  "/auth/refresh",
  refreshIpLimit,
  validate({ body: refreshTokenSchema }),
  refreshSession,
);
authRouter.get("/auth/me", authenticate, getMe);
authRouter.post("/auth/logout", validate({ body: refreshTokenSchema }), logout);
authRouter.post(
  "/auth/password/forgot",
  authIpLimit,
  validate({ body: forgotPasswordSchema }),
  passwordForgotLimit,
  forgotPassword,
);
authRouter.post(
  "/auth/password/reset",
  authIpLimit,
  validate({ body: resetPasswordSchema }),
  passwordResetLimit,
  resetPassword,
);
authRouter.post(
  "/auth/password/change",
  authenticate,
  validate({ body: changePasswordSchema }),
  passwordChangeLimit,
  changePassword,
);
