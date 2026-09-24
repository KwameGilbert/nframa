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

export function isAdmin(req: Request) {
  return req.auth?.role === "admin";
}

// Users may act on records they own; admins may act on anyone's.
export function isSelfOrAdmin(req: Request, ownerId: string) {
  return isAdmin(req) || req.auth?.id === ownerId;
}

// For routes where the owner's id is in the request itself (a path param or body field). Reads
// req.validated, so it must come after authenticate() and validate(). Routes where the owner is only
// known after loading the record (e.g. vehicles) call isSelfOrAdmin from the controller instead.
export function requireSelfOrAdmin(getOwnerId: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!isSelfOrAdmin(req, getOwnerId(req))) {
      next(AppError.forbidden("You do not have permission to perform this action"));
      return;
    }
    next();
  };
}

export const ownerFromIdParam = (req: Request) => (req.validated.params as { id: string }).id;
export const ownerFromUserIdParam = (req: Request) =>
  (req.validated.params as { userId: string }).userId;
export const ownerFromUserIdBody = (req: Request) =>
  (req.validated.body as { userId: string }).userId;
