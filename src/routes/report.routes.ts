import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { reportLimit } from "../middlewares/rateLimit.js";
import { uploadImages } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import {
  adminGetReport,
  adminListReports,
  adminUpdateReportStatus,
  createReport,
  getMyReport,
  listMyReports,
  withdrawReport,
} from "../controllers/report.controller.js";
import {
  MAX_REPORT_EVIDENCE,
  adminListReportsQuerySchema,
  createReportSchema,
  listMyReportsQuerySchema,
  reportParamsSchema,
  tripReportsParamsSchema,
  updateReportStatusSchema,
} from "../schemas/report.schema.js";

export const reportRouter = Router();

// A person's own reports. Who is on the trip decides who may file, so the controller checks it; a report is only
// ever read or withdrawn by the person who filed it (anyone else gets 404). The images of a report are parsed by
// uploadImages before validate(), since express.json() skips multipart bodies.
reportRouter.post(
  "/trips/:tripId/reports",
  authenticate,
  reportLimit,
  uploadImages("evidence", MAX_REPORT_EVIDENCE),
  validate({ params: tripReportsParamsSchema, body: createReportSchema }),
  createReport,
);

reportRouter.get(
  "/reports",
  authenticate,
  validate({ query: listMyReportsQuerySchema }),
  listMyReports,
);

reportRouter.get(
  "/reports/:id",
  authenticate,
  validate({ params: reportParamsSchema }),
  getMyReport,
);

reportRouter.patch(
  "/reports/:id/withdraw",
  authenticate,
  validate({ params: reportParamsSchema }),
  withdrawReport,
);

// Staff.
reportRouter.get(
  "/admin/reports",
  authenticate,
  requirePermission("reports", "read"),
  validate({ query: adminListReportsQuerySchema }),
  adminListReports,
);

reportRouter.get(
  "/admin/reports/:id",
  authenticate,
  requirePermission("reports", "read"),
  validate({ params: reportParamsSchema }),
  adminGetReport,
);

reportRouter.patch(
  "/admin/reports/:id",
  authenticate,
  requirePermission("reports", "update"),
  validate({ params: reportParamsSchema, body: updateReportStatusSchema }),
  adminUpdateReportStatus,
);
