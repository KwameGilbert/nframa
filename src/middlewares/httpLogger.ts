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

// Payment webhooks carry the payer's email, phone and card details: log only which event it was. A boarding
// scan carries the rider's boarding code, which is theirs alone. A trip report carries one person's account of
// another. A saved payment method carries a full phone or account number.
function loggableBody(req: Request) {
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
  return req.body;
}

// Trip views carry the rider's boarding code (for the rider alone): keep it out of the logged response.
export function loggableResponse(body: unknown) {
  const data = (body as { data?: unknown } | undefined)?.data;
  if (typeof data === "object" && data !== null && "boardingCode" in data) {
    return { ...(body as object), data: { ...data, boardingCode: "[REDACTED]" } };
  }
  return body;
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
    responseBody: loggableResponse(res.locals.responseBody),
  }),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
});
