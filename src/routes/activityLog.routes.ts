import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { listActivityLogsQuerySchema } from "../schemas/activityLog.schema.js";
import { listActivityLogs, getActivityLog } from "../controllers/activityLog.controller.js";

export const activityLogRouter = Router();

// Read-only: entries are written by the controllers (logActivity) as they act, and never edited or deleted.
activityLogRouter.get(
  "/admin/activity-logs",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ query: listActivityLogsQuerySchema }),
  listActivityLogs,
);

activityLogRouter.get(
  "/admin/activity-logs/:id",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ params: idParamsSchema }),
  getActivityLog,
);
