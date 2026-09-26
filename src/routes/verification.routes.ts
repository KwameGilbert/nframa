import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import {
  uploadVerificationDocument,
  getDriverDocuments,
  updateDocumentStatus,
  getDocumentHistory,
  listPendingDocuments,
} from "../controllers/verification.controller.js";
import {
  uploadParamsSchema,
  updateDocumentStatusSchema,
} from "../schemas/verification.schema.js";
import { idParamsSchema } from "../schemas/common.schema.js";

export const verificationRouter = Router();

// Driver uploads verification document
verificationRouter.post(
  "/driver/verification/:documentTypeId",
  authenticate,
  validate({ params: uploadParamsSchema }),
  uploadVerificationDocument,
);

// Driver retrieves their verification documents
verificationRouter.get("/driver/verification", authenticate, getDriverDocuments);

// Admin updates document verification status
verificationRouter.patch(
  "/admin/verification/:documentId",
  authenticate,
  requirePermission("roles", "update"),
  validate({ params: idParamsSchema, body: updateDocumentStatusSchema }),
  updateDocumentStatus,
);

// Admin lists pending/under-review documents
verificationRouter.get(
  "/admin/verification/pending",
  authenticate,
  requirePermission("roles", "read"),
  listPendingDocuments,
);

// Get full status history for a document (driver or admin)
verificationRouter.get(
  "/verification/:documentId/history",
  authenticate,
  validate({ params: idParamsSchema }),
  getDocumentHistory,
);
