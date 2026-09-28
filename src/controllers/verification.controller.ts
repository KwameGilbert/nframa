import type { Request, Response } from "express";
import { verificationDocumentModel } from "../models/verificationDocument.model.js";
import { verificationDocumentHistoryModel } from "../models/verificationDocumentHistory.model.js";
import { documentTypeModel } from "../models/documentType.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { uploadFile } from "../services/storage.service.js";
import { assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import type {
  UpdateDocumentStatusInput,
  UpdateDriverVerificationStatusInput,
} from "../schemas/verification.schema.js";

const DOCUMENT_ACTIVITY = { module: "verification", targetType: "verificationDocument" } as const;
const DRIVER_ACTIVITY = { module: "verification", targetType: "driver" } as const;

// Reference data (id, code, name, description, hasExpiry) for building an upload UI — no auth-specific
// filtering, so every signed-in user sees the same list.
export async function listDocumentTypes(_req: Request, res: Response) {
  const types = await documentTypeModel.getAllTypes();
  sendSuccess(res, "Document types retrieved successfully", types);
}

export async function uploadVerificationDocument(req: Request, res: Response) {
  if (!req.auth?.id) {
    throw AppError.unauthorized();
  }
  if (!req.file) {
    throw AppError.badRequest(
      "No file uploaded. Send it as multipart/form-data under the 'file' field",
    );
  }

  const userId = req.auth.id as string;
  const { documentTypeId: typeId } = req.validated.params as { documentTypeId: number };

  // Verify document type exists
  const docType = await documentTypeModel.findById(typeId.toString());
  if (!docType) {
    throw AppError.badRequest(`Document type not found: ${typeId}`);
  }

  // Check if this user already submitted this document type
  const existing = await verificationDocumentModel.getDocumentByUserAndType(userId, typeId);
  if (existing) {
    throw AppError.conflict(
      `You already submitted a ${docType.name}. Contact support to resubmit.`,
    );
  }

  const uploaded = await uploadFile(
    req.file.buffer,
    `verification/${userId}`,
    req.file.originalname,
  );

  const expiresAt = docType.hasExpiry
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const document = await verificationDocumentModel.uploadDocument(
    userId,
    typeId,
    uploaded.fileUrl,
    uploaded.storageKey,
    expiresAt,
  );

  sendCreated(res, "Document uploaded successfully", document);

  logActivity(req, {
    ...DOCUMENT_ACTIVITY,
    action: "verification.document.upload",
    description: `Uploaded a ${docType.name}`,
    targetId: document.id,
    after: document,
  });
}

export async function getDriverDocuments(req: Request, res: Response) {
  if (!req.auth?.id) {
    throw AppError.unauthorized();
  }

  const userId = req.auth.id as string;
  const documents = await verificationDocumentModel.getDocumentsByUserId(userId);

  // Fetch history for each document and nest it
  const documentsWithHistory = await Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      history: await verificationDocumentHistoryModel.getDocumentHistory(doc.id),
    })),
  );

  sendSuccess(res, "Documents retrieved successfully", documentsWithHistory);
}

export async function updateDocumentStatus(req: Request, res: Response) {
  const { documentId } = req.validated.params as { documentId: string };
  const input = req.validated.body as UpdateDocumentStatusInput;

  const document = await verificationDocumentModel.findById(documentId);
  if (!document) {
    throw AppError.notFound(`Document not found: ${documentId}`);
  }

  const verifiedBy = req.auth?.id as string | undefined;
  const updated = await verificationDocumentModel.updateStatus(
    documentId,
    input.status,
    verifiedBy,
    input.notes,
  );

  // Log the status change to history
  await verificationDocumentHistoryModel.logStatusChange(
    documentId,
    document.status, // previous status
    input.status, // new status
    verifiedBy || null,
    input.notes, // reason for the change
  );

  // Recalculate driver verification status
  await recalculateDriverVerificationStatus(req, document.userId);

  sendSuccess(res, "Document status updated successfully", updated);

  logActivity(req, {
    ...DOCUMENT_ACTIVITY,
    action: "verification.document.review",
    description: `Marked a verification document ${input.status.toLowerCase().replace("_", " ")}`,
    targetId: documentId,
    before: document,
    after: updated,
  });
}

export async function getDocumentHistory(req: Request, res: Response) {
  const { documentId } = req.validated.params as { documentId: string };

  const document = await verificationDocumentModel.findById(documentId);
  if (!document) {
    throw AppError.notFound(`Document not found: ${documentId}`);
  }
  await assertSelfOrPermission(req, document.userId, "verification", "read");

  const history = await verificationDocumentHistoryModel.getDocumentHistory(documentId);

  sendSuccess(res, "Document history retrieved successfully", history);
}

export async function listPendingDocuments(_req: Request, res: Response) {
  const pending = await verificationDocumentModel.getPendingDocumentsWithDetails();
  sendSuccess(res, "Pending documents retrieved", pending);
}

export async function updateDriverVerificationStatus(req: Request, res: Response) {
  const { userId } = req.validated.params as { userId: string };
  const input = req.validated.body as UpdateDriverVerificationStatusInput;

  const existing = await driverProfileModel.findByIdWithRelations(userId);
  if (!existing) {
    throw AppError.notFound(`Driver profile not found for user: ${userId}`);
  }

  if (input.verificationStatus === "approved") {
    await assertReadyForApproval(userId);
  }

  // Update driver's verification status
  await driverProfileModel.updateVerificationStatus(userId, input.verificationStatus);

  // Fetch full driver profile with relations
  const result = await driverProfileModel.findByIdWithRelations(userId);

  if (!result) {
    throw AppError.notFound(`Driver profile not found for user: ${userId}`);
  }

  sendSuccess(res, "Driver verification status updated successfully", result);

  logActivity(req, {
    ...DRIVER_ACTIVITY,
    action: "verification.driver.update",
    description: `Marked a driver ${input.verificationStatus}`,
    targetId: userId,
    before: existing,
    after: result,
  });
}

// Approval is only possible once the driver has submitted a document of every required type, and every
// document they've submitted is verified and in date.
async function assertReadyForApproval(userId: string) {
  const [documents, requiredTypes] = await Promise.all([
    verificationDocumentModel.getDocumentsByUserId(userId),
    documentTypeModel.getRequiredTypes(),
  ]);

  const submitted = new Set(documents.map((doc) => doc.documentTypeId));
  const missing = requiredTypes.filter((type) => !submitted.has(type.id));
  if (missing.length > 0) {
    throw AppError.badRequest(
      `Cannot approve driver: missing required document(s): ${missing.map((type) => type.name).join(", ")}`,
    );
  }

  if (documents.length === 0) {
    throw AppError.badRequest("Cannot approve driver: no documents submitted");
  }

  const unverifiedDocs = documents.filter((doc) => doc.status !== "VERIFIED");
  if (unverifiedDocs.length > 0) {
    throw AppError.badRequest(
      `Cannot approve driver: ${unverifiedDocs.length} document(s) not yet verified`,
    );
  }

  const now = new Date();
  const expiredDocs = documents.filter((doc) => doc.expiresAt && new Date(doc.expiresAt) < now);
  if (expiredDocs.length > 0) {
    throw AppError.badRequest(
      `Cannot approve driver: ${expiredDocs.length} document(s) have expired`,
    );
  }
}

// Helper: Recalculate driver verification status based on document statuses
async function recalculateDriverVerificationStatus(req: Request, userId: string): Promise<void> {
  const [documents, driverProfile] = await Promise.all([
    verificationDocumentModel.getDocumentsByUserId(userId),
    driverProfileModel.findById(userId),
  ]);
  if (!driverProfile) {
    return;
  }

  // Count statuses
  const statuses = documents.reduce(
    (acc, doc) => {
      acc[doc.status] = (acc[doc.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  let newStatus: "unverified" | "pending" | "approved" | "rejected" | "expiring" = "unverified";

  // Logic: driver's verification status = worst case of all docs
  if (statuses.REJECTED && statuses.REJECTED > 0) {
    newStatus = "rejected";
  } else if (statuses.EXPIRED && statuses.EXPIRED > 0) {
    newStatus = "expiring";
  } else if (statuses.PENDING && statuses.PENDING > 0) {
    newStatus = "pending";
  } else if (statuses["UNDER_REVIEW"] && statuses["UNDER_REVIEW"] > 0) {
    newStatus = "pending";
  } else if (statuses.VERIFIED === documents.length && documents.length > 0) {
    // Approval is an admin's decision (PATCH /admin/driver/:userId/verification), never automatic: with every
    // document verified the driver waits in pending for it, and a driver already approved stays approved.
    newStatus = driverProfile.verificationStatus === "approved" ? "approved" : "pending";
  }

  if (driverProfile.verificationStatus !== newStatus) {
    await driverProfileModel.updateVerificationStatus(userId, newStatus);
    // Its own entry: the admin reviewed one document, but this changed the driver as a whole.
    logActivity(req, {
      ...DRIVER_ACTIVITY,
      action: "verification.driver.recalculate",
      description: `Driver's verification status changed to ${newStatus} after a document review`,
      targetId: userId,
      before: { verificationStatus: driverProfile.verificationStatus },
      after: { verificationStatus: newStatus },
    });
  }
}
