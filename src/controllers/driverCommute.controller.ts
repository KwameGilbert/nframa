import type { Request, Response } from "express";
import { driverCommuteModel } from "../models/driverCommute.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { assertPermission, assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  CreateDriverCommuteInput,
  UpdateDriverCommuteInput,
} from "../schemas/driverCommute.schema.js";

const COMMUTE_ACTIVITY = { module: "commutes", targetType: "commute" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

// Loads the commute and checks the caller owns it (or has the admin permission) — the owner isn't in the
// request, so this can't be done in route middleware.
async function findCommuteFor(req: Request, id: string, action: "read" | "update" | "delete") {
  const commute = await driverCommuteModel.findById(id);

  if (!commute) {
    throw AppError.notFound(`Commute not found: ${id}`);
  }
  await assertSelfOrPermission(req, commute.userId, "commutes", action);

  return commute;
}

export async function listDriverCommutes(req: Request, res: Response) {
  const userId = callerId(req);

  // Admins with commutes: read see every driver's commutes; everyone else sees only their own.
  const seesAll = req.auth?.role === "admin";
  if (seesAll) {
    await assertPermission(req, "commutes", "read");
  }

  const commutes = await driverCommuteModel.list(seesAll ? {} : { userId });

  sendSuccess(res, "Commutes retrieved successfully", commutes);
}

export async function createDriverCommute(req: Request, res: Response) {
  const input = req.validated.body as CreateDriverCommuteInput;
  const ownerId = input.userId ?? callerId(req);

  await assertSelfOrPermission(req, ownerId, "commutes", "create");
  if (!(await driverProfileModel.findById(ownerId))) {
    throw AppError.badRequest(`No driver profile for user: ${ownerId}`);
  }

  const commute = await driverCommuteModel.createCommute(input, ownerId);

  sendCreated(res, "Commute created successfully", commute);

  logActivity(req, {
    ...COMMUTE_ACTIVITY,
    action: "commute.create",
    description: "Added a commute",
    targetId: commute.id,
    after: commute,
  });
}

export async function getDriverCommute(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const commute = await findCommuteFor(req, id, "read");

  sendSuccess(res, "Commute retrieved successfully", commute);
}

export async function updateDriverCommute(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateDriverCommuteInput;

  const existing = await findCommuteFor(req, id, "update");
  const commute = await driverCommuteModel.updateCommute(id, input);

  if (!commute) {
    throw AppError.notFound(`Commute not found: ${id}`);
  }

  sendSuccess(res, "Commute updated successfully", commute);

  logActivity(req, {
    ...COMMUTE_ACTIVITY,
    action: "commute.update",
    description: "Updated a commute",
    targetId: id,
    before: existing,
    after: commute,
  });
}

export async function deleteDriverCommute(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const existing = await findCommuteFor(req, id, "delete");
  await driverCommuteModel.deleteById(id);

  sendSuccess(res, "Commute deleted successfully");

  logActivity(req, {
    ...COMMUTE_ACTIVITY,
    action: "commute.delete",
    description: "Deleted a commute",
    targetId: id,
    before: existing,
  });
}
