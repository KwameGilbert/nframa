import type { Response } from "express";

// Successful responses are { success: true, message, data }; errors are { success: false, error }
// (see middlewares/errorHandler.ts). data is null when there's nothing to return (e.g. a delete or logout),
// so clients can always read all three fields.
export function sendSuccess<T>(res: Response, message: string, data?: T, statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data: data ?? null });
}

export function sendCreated<T>(res: Response, message: string, data: T) {
  return sendSuccess(res, message, data, 201);
}
