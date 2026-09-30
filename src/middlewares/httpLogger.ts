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

// Payment webhooks carry the payer's email, phone and card details: log only which event it was.
function loggableBody(req: Request) {
  if (req.originalUrl.startsWith("/webhooks/")) {
    const event = (req.body as { event?: unknown } | undefined)?.event;
    return { event, details: "[REDACTED]" };
  }
  return req.body;
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
    responseBody: res.locals.responseBody,
  }),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
});
