import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError && err.isOperational ? err.message : "Internal server error";

  req.log.child({ type: "error" }).error({ err }, err.message);

  // Same envelope as success responses (utils/response.ts), minus data.
  res.status(statusCode).json({ success: false, message });
}
