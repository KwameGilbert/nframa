import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  createSettingSchema,
  settingKeyParamsSchema,
  updateSettingSchema,
} from "../schemas/setting.schema.js";
import {
  listSettings,
  getSetting,
  createSetting,
  updateSetting,
  deleteSetting,
} from "../controllers/setting.controller.js";

export const settingRouter = Router();

settingRouter.get("/settings", authenticate, requirePermission("settings", "read"), listSettings);

settingRouter.post(
  "/settings",
  authenticate,
  requirePermission("settings", "create"),
  validate({ body: createSettingSchema }),
  createSetting,
);

settingRouter.get(
  "/settings/:key",
  authenticate,
  requirePermission("settings", "read"),
  validate({ params: settingKeyParamsSchema }),
  getSetting,
);

settingRouter.patch(
  "/settings/:key",
  authenticate,
  requirePermission("settings", "update"),
  validate({ params: settingKeyParamsSchema, body: updateSettingSchema }),
  updateSetting,
);

settingRouter.delete(
  "/settings/:key",
  authenticate,
  requirePermission("settings", "delete"),
  validate({ params: settingKeyParamsSchema }),
  deleteSetting,
);
