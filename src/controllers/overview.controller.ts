import type { Request, Response } from "express";
import { getOverview as buildOverview } from "../services/overview.service.js";
import { sendSuccess } from "../utils/response.js";
import type { OverviewQuery } from "../schemas/overview.schema.js";

export async function getOverview(req: Request, res: Response) {
  const query = req.validated.query as OverviewQuery;
  sendSuccess(res, "Overview retrieved successfully", await buildOverview(query));
}
