import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { requestOtpSchema, verifyOtpSchema, refreshTokenSchema } from "../schemas/auth.schema.js";
import { requestOtp, verifyOtp, refreshSession, logout } from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/auth/otp/request", validate({ body: requestOtpSchema }), requestOtp);
authRouter.post("/auth/otp/verify", validate({ body: verifyOtpSchema }), verifyOtp);
authRouter.post("/auth/refresh", validate({ body: refreshTokenSchema }), refreshSession);
authRouter.post("/auth/logout", validate({ body: refreshTokenSchema }), logout);
