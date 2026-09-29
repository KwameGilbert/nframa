import type { Request, Response } from "express";
import { userModel, type User } from "../models/user.model.js";
import { roleModel } from "../models/role.model.js";
import { authSessionModel } from "../models/authSession.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { userStatusHistoryModel } from "../models/userStatusHistory.model.js";
import { activityLogModel } from "../models/activityLog.model.js";
import { assertPermission, assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
} from "../schemas/user.schema.js";
import type { UserActivityLogsQuery } from "../schemas/activityLog.schema.js";

// Admin accounts are managed under "admin" (a dedicated module — see MODULES), riders/drivers under
// "users" — otherwise anyone with users access could edit an admin's email and take the account over via
// password reset. "roles" stays separate again: it's role/permission definitions, not admin accounts.
function moduleFor(user: Pick<User, "role">) {
  return user.role === "admin" ? "admin" : "users";
}

const USER_ACTIVITY = { module: "users", targetType: "user" } as const;

export async function findUserOrThrow(id: string) {
  const user = await userModel.findById(id);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  return user;
}

// Admin accounts get extra guards: no deleting yourself (lockout), and only an admin in a system role
// (superadmin) can delete another one — otherwise anyone with admin: delete could remove every superadmin.
async function assertCanDeleteAdmin(req: Request, target: User) {
  if (req.auth?.id === target.id) {
    throw AppError.forbidden("You can't delete your own admin account");
  }

  const targetRole = await roleModel.findForAdmin(target.id);
  if (targetRole?.isSystem) {
    const callerRole = req.auth ? await roleModel.findForAdmin(req.auth.id) : undefined;
    if (!callerRole?.isSystem) {
      throw AppError.forbidden(`Only an admin with a system role can delete a ${targetRole.name}`);
    }
  }
}

// Shared by DELETE /users/:id and DELETE /admin/:userId, so admin accounts get the same guards either way.
// Permission to delete the target is checked by the caller first.
export async function softDeleteAccount(req: Request, target: User) {
  if (target.deletedAt) {
    throw AppError.conflict("User is already deleted");
  }
  if (target.role === "admin") {
    await assertCanDeleteAdmin(req, target);
  }

  await userModel.softDelete(target.id);
  // Existing access tokens die within 15 minutes; this makes sure none of them can be refreshed.
  await authSessionModel.revokeAllForUser(target.id);
}

// Riders and drivers only — see findAllRidersAndDrivers. Admin accounts are listed via GET /admin instead,
// which needs admin: read rather than users: read.
export async function listUsers(_req: Request, res: Response) {
  const users = await userModel.findAllRidersAndDrivers();

  sendSuccess(res, "Users retrieved successfully", users);
}

export async function createUser(req: Request, res: Response) {
  const input = req.validated.body as CreateUserInput;

  await assertPermission(req, moduleFor(input), "create");

  const user = await userModel.createUser(input);

  sendCreated(res, "User created successfully", user);

  logActivity(req, {
    ...USER_ACTIVITY,
    action: "user.create",
    description: `Created a ${user.role} account`,
    targetId: user.id,
    after: user,
  });
}

export async function getUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const user = await findUserOrThrow(id);
  await assertSelfOrPermission(req, user.id, moduleFor(user), "read");

  const isSelf = req.auth?.id === user.id;
  const history = await userStatusHistoryModel.getHistory(id);
  // notes is staff-only — an account holder viewing their own record still sees why (reason) and when, just
  // not internal commentary. An admin viewing someone else's account (the only other way to reach this) sees it.
  const statusHistory = isSelf ? history.map((entry) => ({ ...entry, notes: null })) : history;

  sendSuccess(res, "User retrieved successfully", { ...user, statusHistory });

  if (!isSelf) {
    logActivity(req, {
      module: "users",
      action: "user.view",
      description: `Viewed a ${user.role} account`,
      targetType: "user",
      targetId: user.id,
    });
  }
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { email, phoneCountryCode, phoneNumber, profile, ...personalFields } = req.validated
    .body as UpdateUserInput;

  const target = await findUserOrThrow(id);
  await assertSelfOrPermission(req, target.id, moduleFor(target), "update");

  if (profile && target.role !== "driver") {
    throw AppError.badRequest("profile can only be set for driver accounts");
  }
  if (profile && !(await driverProfileModel.findById(id))) {
    throw AppError.badRequest("This driver has no profile yet — create one first via POST /driver");
  }

  // A changed identifier is no longer verified. Resending the current value isn't a change.
  const emailChanged = email !== undefined && email !== target.email;
  const phoneChanged =
    (phoneCountryCode !== undefined && phoneCountryCode !== target.phoneCountryCode) ||
    (phoneNumber !== undefined && phoneNumber !== target.phoneNumber);

  const userFields = {
    ...personalFields,
    ...(emailChanged && { email, isEmailVerified: false }),
    ...(phoneChanged && { phoneCountryCode, phoneNumber, isPhoneVerified: false }),
  };

  // Personal and driver-specific fields are written in one transaction when profile is included, so a
  // dashboard editing both together can't leave one saved without the other on a partial failure. The
  // response stays the same flat user shape either way.
  const user = profile
    ? (await driverProfileModel.updateProfileWithUser(id, profile, userFields))?.driver.user
    : await userModel.updateUser(id, userFields);

  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  sendSuccess(res, "User updated successfully", user);

  logActivity(req, {
    ...USER_ACTIVITY,
    action: "user.update",
    description: `Updated a ${user.role} account`,
    targetId: id,
    before: target,
    after: user,
  });
}


// Suspending is a distinct moderation action, not a routine profile edit — kept off PATCH /users/:id so
// it gets its own permission check, self-lockout guard, and activity log action (mirrors PATCH
// /admin/:userId's status field for admins, but as its own endpoint here since updateUserSchema is mostly
// self-editable profile fields that a suspend/reactivate shouldn't be mixed in with).
export async function updateUserStatus(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { status, reason, notes } = req.validated.body as UpdateUserStatusInput;

  if (req.auth?.id === id) {
    throw AppError.forbidden("You can't change your own account status");
  }

  const target = await findUserOrThrow(id);
  await assertPermission(req, moduleFor(target), "update");

  if (target.status === status) {
    throw AppError.conflict(`Account is already ${status}`);
  }

  const user = await userModel.setStatus(id, status);
  if (!user) {
    throw AppError.notFound(`User not found: ${id}`);
  }

  if (status === "suspended") {
    // Existing access tokens die within 15 minutes; this makes sure none of them can be refreshed.
    await authSessionModel.revokeAllForUser(id);
  }

  // The full reason/notes live here, not on the users row itself — GET /users/:id/status-history is
  // where a dashboard reads "why", across every past transition, not just the current one.
  await userStatusHistoryModel.logStatusChange(
    id,
    target.status,
    status,
    req.auth?.id ?? null,
    reason,
    notes,
  );

  sendSuccess(res, `Account ${status} successfully`, user);

  logActivity(req, {
    ...USER_ACTIVITY,
    action: status === "suspended" ? "user.suspend" : "user.reactivate",
    description:
      `${status === "suspended" ? "Suspended" : "Reactivated"} a ${target.role} account` +
      (reason ? ` (${reason})` : ""),
    targetId: id,
    before: target,
    after: user,
  });
}

// Admin-only: reason is meant for the account holder to see on request, but notes are internal, so this
// isn't exposed via assertSelfOrPermission the way GET /users/:id is.
export async function getUserStatusHistory(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const target = await findUserOrThrow(id);
  await assertPermission(req, moduleFor(target), "read");

  const history = await userStatusHistoryModel.getHistory(id);

  sendSuccess(res, "Status history retrieved successfully", history);

  logActivity(req, {
    module: "users",
    action: "user.status.history.view",
    description: `Viewed a ${target.role} account's status history`,
    targetType: "user",
    targetId: id,
  });
}

// The full audit-log shape (IP, request body, etc.), so this is gated on activityLogs: read like
// GET /admin/activity-logs itself, not on users: read — someone with only users: read shouldn't get audit
// detail through a side door. Combines both directions: what this account did (actor) and what was done to
// it (target) — GET /admin/activity-logs?targetType=user&targetId=<id> alone only covers the latter.
export async function getUserActivityLogs(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { page, limit } = req.validated.query as UserActivityLogsQuery;

  await findUserOrThrow(id);

  const { items, stats } = await activityLogModel.forUser(id, { page, limit });

  sendSuccess(res, "User activity logs retrieved successfully", {
    items,
    pagination: { page, limit, totalItems: stats.total, totalPages: Math.ceil(stats.total / limit) },
    stats,
  });

  logActivity(req, {
    module: "activityLogs",
    action: "activityLogs.user.list",
    description: `Viewed ${items.length} activity log entr${items.length === 1 ? "y" : "ies"} for a user (page ${page})`,
    targetType: "user",
    targetId: id,
  });
}

export async function deleteUser(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const target = await findUserOrThrow(id);
  await assertSelfOrPermission(req, target.id, moduleFor(target), "delete");
  await softDeleteAccount(req, target);

  sendSuccess(res, "User deleted successfully");

  logActivity(req, {
    ...USER_ACTIVITY,
    action: "user.delete",
    description: `Deleted a ${target.role} account`,
    targetId: id,
    before: target,
  });
}
