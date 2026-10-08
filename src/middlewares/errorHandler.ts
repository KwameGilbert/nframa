import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

// Debug mode exposes full error details and stack traces to clients. Set DEBUG_ERRORS=true to enable.
function isDebugMode(): boolean {
  return process.env.DEBUG_ERRORS === "true";
}

// Errors raised before our code runs — express.json() on a malformed body, a body over the size limit —
// carry their own 4xx status and a message marked safe to show (`expose`). Without this they'd be 500s.
function toStatusAndMessage(err: Error) {
  const debug = isDebugMode();

  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      message: err.isOperational || debug ? err.message : "Internal server error",
      ...(debug && { stack: err.stack }),
    };
  }

  const httpError = err as { status?: number; expose?: boolean; type?: string };
  if (httpError.expose && httpError.status && httpError.status < 500) {
    const message =
      httpError.type === "entity.parse.failed" ? "Request body is not valid JSON" : err.message;
    return { statusCode: httpError.status, message, ...(debug && { stack: err.stack }) };
  }

  return {
    statusCode: 500,
    message: debug ? err.message : "Internal server error",
    ...(debug && { stack: err.stack, name: err.name }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const { statusCode, message, stack, name } = toStatusAndMessage(err);

  req.log.child({ type: "error" }).error({ err }, err.message);
  // 500s reach Sentry through its Express integration (instrument.ts), which skips errors with a 4xx status.

  // Errors are { success: false, error }; successes are { success: true, message, data } (utils/response.ts).
  // In debug mode, include stack trace and error name for easier debugging.
  const response: Record<string, unknown> = { success: false, error: message };
  if (stack) {
    response.stack = stack;
  }
  if (name) {
    response.errorType = name;
  }
  res.status(statusCode).json(response);
}
