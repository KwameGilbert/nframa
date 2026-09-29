import type { Request, Response } from "express";
import { userModel, type User } from "../models/user.model.js";
import { roleModel } from "../models/role.model.js";
import { authSessionModel } from "../models/authSession.model.js";
import { assertPermission, assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
} from "../schemas/user.schema.js";

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

  sendSuccess(res, "User retrieved successfully", user);

  if (req.auth?.id !== user.id) {
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
  const { email, phoneCountryCode, phoneNumber, ...profile } = req.validated
    .body as UpdateUserInput;

  const target = await findUserOrThrow(id);
  await assertSelfOrPermission(req, target.id, moduleFor(target), "update");

  // A changed identifier is no longer verified. Resending the current value isn't a change.
  const emailChanged = email !== undefined && email !== target.email;
  const phoneChanged =
    (phoneCountryCode !== undefined && phoneCountryCode !== target.phoneCountryCode) ||
    (phoneNumber !== undefined && phoneNumber !== target.phoneNumber);

  const user = await userModel.updateUser(id, {
    ...profile,
    ...(emailChanged && { email, isEmailVerified: false }),
    ...(phoneChanged && { phoneCountryCode, phoneNumber, isPhoneVerified: false }),
  });

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
  const { status } = req.validated.body as UpdateUserStatusInput;

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

  sendSuccess(res, `Account ${status} successfully`, user);

  logActivity(req, {
    ...USER_ACTIVITY,
    action: status === "suspended" ? "user.suspend" : "user.reactivate",
    description: `${status === "suspended" ? "Suspended" : "Reactivated"} a ${target.role} account`,
    targetId: id,
    before: target,
    after: user,
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
