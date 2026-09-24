import type { NextFunction, Request, Response } from "express";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { AppError } from "../utils/AppError.js";
import type { Action, Module, PermissionMap } from "../config/permissions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required by Express's ambient augmentation pattern
  namespace Express {
    interface Request {
      permissions?: PermissionMap;
    }
  }
}

// Everything here must run after authenticate(). Admin powers come from the admin's role permissions,
// read from the database (once per request) rather than the token, so role edits and suspensions apply
// immediately.

export async function loadPermissions(req: Request): Promise<PermissionMap> {
  req.permissions ??=
    req.auth?.role === "admin" ? await rolePermissionModel.findForActiveAdmin(req.auth.id) : {};
  return req.permissions;
}

export async function hasPermission(req: Request, module: Module, action: Action) {
  const permissions = await loadPermissions(req);
  return permissions[module]?.[action] === true;
}

function forbidden(module: Module, action: Action) {
  return AppError.forbidden(`Missing permission: ${action} on ${module}`);
}

export async function assertPermission(req: Request, module: Module, action: Action) {
  if (!(await hasPermission(req, module, action))) {
    throw forbidden(module, action);
  }
}

// Users may act on records they own; anyone else needs the admin permission.
export async function assertSelfOrPermission(
  req: Request,
  ownerId: string,
  module: Module,
  action: Action,
) {
  if (req.auth?.id === ownerId) {
    return;
  }
  await assertPermission(req, module, action);
}

export function requirePermission(module: Module, action: Action) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    await assertPermission(req, module, action);
    next();
  };
}

// For routes where the owner's id is in the request itself (a path param or body field). Reads
// req.validated, so it must come after validate(). When the owner is only known after loading the record
// (e.g. vehicles, or users where admin accounts need a different module), the controller calls
// assertSelfOrPermission instead.
export function requireSelfOrPermission(
  getOwnerId: (req: Request) => string,
  module: Module,
  action: Action,
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    await assertSelfOrPermission(req, getOwnerId(req), module, action);
    next();
  };
}

export const ownerFromUserIdParam = (req: Request) =>
  (req.validated.params as { userId: string }).userId;
export const ownerFromUserIdBody = (req: Request) =>
  (req.validated.body as { userId: string }).userId;
