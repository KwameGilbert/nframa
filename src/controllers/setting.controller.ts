import type { Request, Response } from "express";
import { settingModel, type Setting } from "../models/setting.model.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import {
  isValidSettingValue,
  settingValueError,
  type CreateSettingInput,
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

export async function listSettings(_req: Request, res: Response) {
  sendSuccess(res, "Settings retrieved successfully", await settingModel.list());
}

export async function getSetting(req: Request, res: Response) {
  const { key } = req.validated.params as SettingKeyParams;

  sendSuccess(res, "Setting retrieved successfully", await findSettingOrThrow(key));
}

export async function createSetting(req: Request, res: Response) {
  const input = req.validated.body as CreateSettingInput;

  if (await settingModel.findById(input.key)) {
    throw AppError.conflict(`Setting already exists: ${input.key}`);
  }

  const setting = await settingModel.createSetting(input, callerId(req));

  sendCreated(res, "Setting created successfully", setting);
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
}

export async function deleteSetting(req: Request, res: Response) {
  const { key } = req.validated.params as SettingKeyParams;

  await findSettingOrThrow(key);
  await settingModel.deleteById(key);

  sendSuccess(res, "Setting deleted successfully");
}
