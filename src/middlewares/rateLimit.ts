import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { AppError } from "../utils/AppError.js";

// Counters live in memory: they reset on restart and aren't shared between instances —
// move to a shared store (e.g. Redis) before running more than one instance.
const WINDOW_MS = 15 * 60 * 1000;

type KeyFn = (req: Request) => string | undefined;

const byIp: KeyFn = (req) => ipKeyGenerator(req.ip ?? "");

// Email for email requests, full phone number for phone requests — the same key OTP codes use.
// Reads req.validated, so these limiters must come after validate() (emails are lowercased by then).
const byIdentifier: KeyFn = (req) => {
  const body = req.validated.body as Record<string, unknown> | undefined;
  if (typeof body?.email === "string") {
    return body.email;
  }
  if (typeof body?.phoneCountryCode === "string" && typeof body.phoneNumber === "string") {
    return `${body.phoneCountryCode}${body.phoneNumber}`;
  }
  return undefined;
};

// Must come after authenticate().
const byUser: KeyFn = (req) => req.auth?.id;

function limitBy(key: KeyFn, limit: number, { failuresOnly = false } = {}) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    skipSuccessfulRequests: failuresOnly,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => key(req) === undefined,
    keyGenerator: (req) => key(req) ?? "",
    handler: (_req, _res, next) => {
      next(AppError.tooManyRequests());
    },
  });
}

// Coarse flood guard shared by every credential endpoint. Kept generous because mobile carriers put many
// users behind one IP (CGNAT); the per-account limits below are what actually stop code/password guessing.
export const authIpLimit = limitBy(byIp, 100);
export const refreshIpLimit = limitBy(byIp, 300);

// Only failed attempts count, so normal use never hits these.
export const loginLimit = limitBy(byIdentifier, 10, { failuresOnly: true });
export const otpVerifyLimit = limitBy(byIdentifier, 10, { failuresOnly: true });
export const passwordResetLimit = limitBy(byIdentifier, 10, { failuresOnly: true });
export const passwordChangeLimit = limitBy(byUser, 5, { failuresOnly: true });

// Every request counts — each one sends an SMS or email.
export const otpSendLimit = limitBy(byIdentifier, 5);
export const passwordForgotLimit = limitBy(byIdentifier, 5);
