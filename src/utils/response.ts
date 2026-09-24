import type { Response } from "express";

// Every API response uses one envelope: { success, message, data }. Errors use the same shape with
// success: false and no data (see middlewares/errorHandler.ts). data is null when there's nothing to return
// (e.g. a delete or logout), so clients can always read all three fields.
export function sendSuccess<T>(res: Response, message: string, data?: T, statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data: data ?? null });
}

export function sendCreated<T>(res: Response, message: string, data: T) {
  return sendSuccess(res, message, data, 201);
}
