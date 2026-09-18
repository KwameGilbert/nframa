import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      next(AppError.forbidden("You do not have permission to perform this action"));
      return;
    }
    next();
  };
}
