import type { Request, Response } from "express";
import { sendSuccess } from "../utils/response.js";

export function getHealth(_req: Request, res: Response) {
  sendSuccess(res, "Service is healthy", { status: "ok" });
}

export function getRoot(_req: Request, res: Response) {
  sendSuccess(res, "Welcome to the Nframa API", {
    status: "ok",
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
