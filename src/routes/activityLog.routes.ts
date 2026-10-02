import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  activityLogUserParamsSchema,
  listActivityLogsQuerySchema,
  userActivityLogsQuerySchema,
} from "../schemas/activityLog.schema.js";
import { listActivityLogs, getActivityLog } from "../controllers/activityLog.controller.js";
import { getUserActivityLogs } from "../controllers/user.controller.js";

export const activityLogRouter = Router();

// Read-only: entries are written by the controllers (logActivity) as they act, and never edited or deleted.
activityLogRouter.get(
  "/admin/activity-logs",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ query: listActivityLogsQuerySchema }),
  listActivityLogs,
);

// Get activity logs for a specific user ID
activityLogRouter.get(
  "/activity-logs/user/:userId",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ params: activityLogUserParamsSchema, query: userActivityLogsQuerySchema }),
  getUserActivityLogs,
);

activityLogRouter.get(
  "/admin/activity-logs/user/:userId",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ params: activityLogUserParamsSchema, query: userActivityLogsQuerySchema }),
  getUserActivityLogs,
);

activityLogRouter.get(
  "/admin/activity-logs/:id",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ params: idParamsSchema }),
  getActivityLog,
);
