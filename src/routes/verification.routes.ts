import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import { uploadSingleFile } from "../middlewares/upload.js";
import {
  listDocumentTypes,
  uploadVerificationDocument,
  getDriverDocuments,
  updateDocumentStatus,
  getDocumentHistory,
  listPendingDocuments,
  updateDriverVerificationStatus,
} from "../controllers/verification.controller.js";
import {
  uploadParamsSchema,
  documentIdParamsSchema,
  updateDocumentStatusSchema,
  updateDriverVerificationStatusSchema,
} from "../schemas/verification.schema.js";
import { driverProfileParamsSchema } from "../schemas/driverProfile.schema.js";

export const verificationRouter = Router();

// Reference data for the upload UI — any signed-in user (any role) can list it.
verificationRouter.get("/document-types", authenticate, listDocumentTypes);

// Driver uploads verification document as multipart/form-data (field name "file"). express.json() (in
// app.ts) skips non-JSON bodies, so uploadSingleFile is what actually parses this request and fills
// req.file — it runs first so a bad file (wrong type, too large) is rejected before anything else runs.
verificationRouter.post(
  "/driver/verification/:documentTypeId",
  authenticate,
  uploadSingleFile("file"),
  validate({ params: uploadParamsSchema }),
  uploadVerificationDocument,
);

// Driver retrieves their verification documents
verificationRouter.get("/driver/verification", authenticate, getDriverDocuments);

// Admin updates document verification status
verificationRouter.patch(
  "/admin/verification/document/:documentId",
  authenticate,
  requirePermission("verification", "update"),
  validate({ params: documentIdParamsSchema, body: updateDocumentStatusSchema }),
  updateDocumentStatus,
);

// Admin lists pending/under-review documents for drivers
verificationRouter.get(
  "/admin/driver/verification/pending",
  authenticate,
  requirePermission("verification", "read"),
  listPendingDocuments,
);

// The document's own driver can see its history, or an admin with verification: read. Ownership is only
// known once the document is loaded, so this is checked in the controller rather than route middleware.
verificationRouter.get(
  "/verification/:documentId/history",
  authenticate,
  validate({ params: documentIdParamsSchema }),
  getDocumentHistory,
);

// Admin updates driver's overall verification status (distinct from individual document updates)
verificationRouter.patch(
  "/admin/driver/:userId/verification",
  authenticate,
  requirePermission("verification", "update"),
  validate({ params: driverProfileParamsSchema, body: updateDriverVerificationStatusSchema }),
  updateDriverVerificationStatus,
);
