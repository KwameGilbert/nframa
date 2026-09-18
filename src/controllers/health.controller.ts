import type { Request, Response } from "express";

export function getHealth(_req: Request, res: Response) {
  res.json({ status: "ok" });
}

export function getRoot(_req: Request, res: Response) {
  res.json({
    status: "ok",
    message: "Welcome to the Nframa API",
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
