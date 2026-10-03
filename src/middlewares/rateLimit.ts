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

// Every request counts — each top-up start or verify calls Paystack. Shared by both routes, per account.
export const walletPaymentLimit = limitBy(byUser, 60);

// Every request counts — each one sends an SMS or email.
export const otpSendLimit = limitBy(byIdentifier, 5);
export const passwordForgotLimit = limitBy(byIdentifier, 5);

// Per account. Every trip request counts: each one asks Google for the rider's route. Browsing and listing
// only read the database, so their limit is just a flood guard.
export const tripRequestLimit = limitBy(byUser, 30);
export const tripBrowseLimit = limitBy(byUser, 300);
// Drivers answering requests and reading their manifests: a flood guard, well above a busy morning's use.
export const tripActionLimit = limitBy(byUser, 120);
// Riders' apps share their location every few seconds while waiting on the day of a trip.
export const tripLocationLimit = limitBy(byUser, 300);
// Per account. An SOS is one button and must never be refused to someone in danger, so this is only a flood guard.
export const sosLimit = limitBy(byUser, 60);
// Every scan counts, so a driver can't guess boarding codes.
export const tripBoardLimit = limitBy(byUser, 60);
// Per account. Filing a report uploads images, so this keeps one account from filling the storage.
export const reportLimit = limitBy(byUser, 20);
