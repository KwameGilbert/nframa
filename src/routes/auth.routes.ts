import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
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
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/auth/login", validate({ body: loginSchema }), login);
authRouter.post("/auth/login/otp", validate({ body: requestOtpSchema }), requestLoginOtp);
authRouter.post("/auth/login/verify", validate({ body: verifyOtpSchema }), verifyLoginOtp);
authRouter.post("/auth/refresh", validate({ body: refreshTokenSchema }), refreshSession);
authRouter.post("/auth/logout", validate({ body: refreshTokenSchema }), logout);
authRouter.post("/auth/password/forgot", validate({ body: forgotPasswordSchema }), forgotPassword);
authRouter.post("/auth/password/reset", validate({ body: resetPasswordSchema }), resetPassword);
authRouter.post(
  "/auth/password/change",
  authenticate,
  validate({ body: changePasswordSchema }),
  changePassword,
);
