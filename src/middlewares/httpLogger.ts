import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { createLogger } from "../config/logger.js";

export function captureResponseBody(_req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = (body?: unknown) => {
    res.locals.responseBody = body;
    return originalJson(body);
  };
  next();
}

// The keys of body that are present, blanked.
function blank(body: unknown, keys: string[]) {
  const copy = { ...(body as object) } as Record<string, unknown>;
  for (const key of keys) {
    if (key in copy) copy[key] = "[REDACTED]";
  }
  return copy;
}

// Payment webhooks carry the payer's email, phone and card details: log only which event it was. A boarding
// scan carries the rider's boarding code, which is theirs alone. A trip report carries one person's account of
// another. A saved payment method carries a full phone or account number. A push token or web-push subscription
// lets whoever holds it push to that device, and a refresh token is a live session.
export function loggableBody(req: Pick<Request, "originalUrl" | "method" | "body">) {
  if (req.originalUrl.startsWith("/devices")) {
    return blank(req.body, ["token", "subscription"]);
  }
  if (req.originalUrl.startsWith("/auth/logout")) {
    return blank(req.body, ["refreshToken", "pushToken"]);
  }
  if (req.originalUrl.startsWith("/auth/refresh")) {
    return blank(req.body, ["refreshToken"]);
  }
  if (req.originalUrl.startsWith("/webhooks/")) {
    const event = (req.body as { event?: unknown } | undefined)?.event;
    return { event, details: "[REDACTED]" };
  }
  if (req.originalUrl.startsWith("/payment-methods") && req.method === "POST") {
    const { phoneNumber, accountNumber, ...rest } = (req.body ?? {}) as Record<string, unknown>;
    return { ...rest, ...(phoneNumber ? { phoneNumber: "[REDACTED]" } : {}), ...(accountNumber ? { accountNumber: "[REDACTED]" } : {}) };
  }
  if (req.method === "POST" && /^\/trips\/[^/]+\/reports/.test(req.originalUrl)) {
    return { ...(req.body as object), description: "[REDACTED]" };
  }
  if (req.originalUrl.startsWith("/trips/board")) {
    return { ...(req.body as object), code: "[REDACTED]" };
  }
  if (isSupportPath(req.originalUrl) && req.body) {
    return blank(req.body, ["subject", "message", "body", "comment"]);
  }
  return req.body;
}

// A support conversation is between one person and staff: none of it goes in the request log.
function isSupportPath(path: string) {
  return path.startsWith("/support") || path.startsWith("/admin/support");
}

// Trip views carry the rider's boarding code (for the rider alone), and the auth routes that sign in (login,
// verify, refresh, password change) return a live token pair: keep them out of the logged response. path is the
// request's URL; without it only the boarding code is blanked.
export function loggableResponse(body: unknown, path = "") {
  const data = (body as { data?: unknown } | undefined)?.data;
  if (typeof data !== "object" || data === null) return body;
  if (isSupportPath(path)) return { ...(body as object), data: "[REDACTED]" };

  const secrets = ["boardingCode", ...(path.startsWith("/auth/") ? ["accessToken", "refreshToken"] : [])];
  if (!secrets.some((key) => key in data)) return body;
  return { ...(body as object), data: blank(data, secrets) };
}

export const httpLogger = pinoHttp<Request, Response>({
  logger: createLogger("http"),
  genReqId: (req, res) => {
    const headerId = req.headers["x-request-id"];
    const id = typeof headerId === "string" ? headerId : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (req, res) => ({
    requestBody: loggableBody(req),
    responseBody: loggableResponse(res.locals.responseBody, req.originalUrl),
  }),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
});
