import type { Request, Response } from "express";
import db from "../database/knex.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";

// A database that takes longer than this to answer `select 1` counts as down.
const DB_CHECK_TIMEOUT_MS = 3000;

// The commit the image was built from (Dockerfile GIT_SHA build arg); "dev" outside an image.
const version = process.env.GIT_SHA || "dev";

export async function getHealth(_req: Request, res: Response) {
  try {
    await db.raw("select 1").timeout(DB_CHECK_TIMEOUT_MS, { cancel: true });
  } catch {
    throw AppError.serviceUnavailable("Database is unreachable");
  }
  sendSuccess(res, "Service is healthy", { status: "ok", database: "ok", version });
}

export function getRoot(_req: Request, res: Response) {
  sendSuccess(res, "Welcome to the Nframa API", {
    status: "ok",
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
