import type { NextFunction, Request, Response } from "express";
import { verifyWebhookSignature } from "../services/paystack.service.js";
import { AppError } from "../utils/AppError.js";

// Before validate(), so an unsigned request is refused before anything reads its body.
export function verifyPaystackSignature(req: Request, _res: Response, next: NextFunction) {
  if (!verifyWebhookSignature(req.rawBody, req.headers["x-paystack-signature"])) {
    throw AppError.unauthorized("Invalid webhook signature");
  }
  next();
}
