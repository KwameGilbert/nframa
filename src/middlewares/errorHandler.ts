import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

// Errors raised before our code runs — express.json() on a malformed body, a body over the size limit —
// carry their own 4xx status and a message marked safe to show (`expose`). Without this they'd be 500s.
function toStatusAndMessage(err: Error) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      message: err.isOperational ? err.message : "Internal server error",
    };
  }

  const httpError = err as { status?: number; expose?: boolean; type?: string };
  if (httpError.expose && httpError.status && httpError.status < 500) {
    const message =
      httpError.type === "entity.parse.failed" ? "Request body is not valid JSON" : err.message;
    return { statusCode: httpError.status, message };
  }

  return { statusCode: 500, message: "Internal server error" };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const { statusCode, message } = toStatusAndMessage(err);

  req.log.child({ type: "error" }).error({ err }, err.message);

  // Errors are { success: false, error }; successes are { success: true, message, data } (utils/response.ts).
  res.status(statusCode).json({ success: false, error: message });
}
