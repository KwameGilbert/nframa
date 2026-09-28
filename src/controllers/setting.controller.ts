import type { Request, Response } from "express";
import { activityLogModel } from "../models/activityLog.model.js";
import { settingModel, type Setting } from "../models/setting.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import {
  isValidSettingValue,
  settingValueError,
  type CreateSettingInput,
  type GetSettingQuery,
  type SettingKeyParams,
  type UpdateSettingInput,
} from "../schemas/setting.schema.js";

async function findSettingOrThrow(key: string): Promise<Setting> {
  const setting = await settingModel.findById(key);

  if (!setting) {
    throw AppError.notFound(`Setting not found: ${key}`);
  }

  return setting;
}

// Every settings route sits behind authenticate, so this only fails if a route is wired without it.
function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

const SETTING_ACTIVITY = { module: "settings", targetType: "setting" } as const;

export async function listSettings(_req: Request, res: Response) {
  sendSuccess(res, "Settings retrieved successfully", await settingModel.list());
}

// The setting comes back with its change history, read from the activity log rather than a history table
// of its own — logActivity already records the before and after of every settings write and who made it.
export async function getSetting(req: Request, res: Response) {
  const { key } = req.validated.params as SettingKeyParams;
  const { historyLimit } = req.validated.query as GetSettingQuery;

  const setting = await findSettingOrThrow(key);
  const history = await activityLogModel.historyFor(SETTING_ACTIVITY.targetType, key, historyLimit);

  sendSuccess(res, "Setting retrieved successfully", { ...setting, history });
}

export async function createSetting(req: Request, res: Response) {
  const input = req.validated.body as CreateSettingInput;

  if (await settingModel.findById(input.key)) {
    throw AppError.conflict(`Setting already exists: ${input.key}`);
  }

  const setting = await settingModel.createSetting(input, callerId(req));

  sendCreated(res, "Setting created successfully", setting);

  logActivity(req, {
    ...SETTING_ACTIVITY,
    action: "setting.create",
    description: "Created a setting",
    targetId: input.key,
    after: setting,
  });
}

export async function updateSetting(req: Request, res: Response) {
  const { key } = req.validated.params as SettingKeyParams;
  const input = req.validated.body as UpdateSettingInput;

  const existing = await findSettingOrThrow(key);
  if (input.value !== undefined && !isValidSettingValue(existing.type, input.value)) {
    throw AppError.badRequest(`value: ${settingValueError(existing.type)}`);
  }

  const setting = await settingModel.updateSetting(key, input, callerId(req));

  sendSuccess(res, "Setting updated successfully", setting);

  logActivity(req, {
    ...SETTING_ACTIVITY,
    action: "setting.update",
    description: "Updated a setting",
    targetId: key,
    before: existing,
    after: setting,
  });
}

export async function deleteSetting(req: Request, res: Response) {
  const { key } = req.validated.params as SettingKeyParams;

  const existing = await findSettingOrThrow(key);
  await settingModel.deleteById(key);

  sendSuccess(res, "Setting deleted successfully");

  logActivity(req, {
    ...SETTING_ACTIVITY,
    action: "setting.delete",
    description: "Deleted a setting",
    targetId: key,
    before: existing,
  });
}
