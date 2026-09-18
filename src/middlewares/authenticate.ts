import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/AppError.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required by Express's ambient augmentation pattern
  namespace Express {
    interface Request {
      auth?: {
        id: string;
        userType: "user" | "admin";
        role: string;
      };
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    next(AppError.unauthorized("Missing or invalid Authorization header"));
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = await verifyAccessToken(token);
    req.auth = { id: payload.sub, userType: payload.userType, role: payload.role };
    next();
  } catch {
    next(AppError.unauthorized("Invalid or expired access token"));
  }
}
