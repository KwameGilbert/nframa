import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { overviewLimit } from "../middlewares/rateLimit.js";
import { overviewQuerySchema } from "../schemas/overview.schema.js";
import { getOverview } from "../controllers/overview.controller.js";

export const overviewRouter = Router();

// Read-only dashboard: headline counts, trends, trip activity, the verification queue and recent admin actions.
overviewRouter.get(
  "/admin/overview",
  authenticate,
  overviewLimit,
  requirePermission("overview", "read"),
  validate({ query: overviewQuerySchema }),
  getOverview,
);
