import type { Request, Response } from "express";
import { activityLogModel } from "../models/activityLog.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";
import type { ListActivityLogsQuery } from "../schemas/activityLog.schema.js";

export async function listActivityLogs(req: Request, res: Response) {
  const query = req.validated.query as ListActivityLogsQuery;
  const { items, stats } = await activityLogModel.list(query);

  sendSuccess(res, "Activity logs retrieved successfully", {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems: stats.total,
      totalPages: Math.ceil(stats.total / query.limit),
    },
    stats,
  });

  logActivity(req, {
    module: "activityLogs",
    action: "activityLogs.list",
    description: `Viewed ${items.length} activity log entr${items.length === 1 ? "y" : "ies"} (page ${query.page})`,
    targetType: "activityLog",
  });
}

export async function getActivityLog(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const log = await activityLogModel.findWithActor(id);
  if (!log) {
    throw AppError.notFound(`Activity log not found: ${id}`);
  }

  sendSuccess(res, "Activity log retrieved successfully", log);

  logActivity(req, {
    module: "activityLogs",
    action: "activityLogs.view",
    description: "Viewed an activity log entry",
    targetType: "activityLog",
    targetId: id,
  });
}
