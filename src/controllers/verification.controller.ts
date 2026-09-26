import type { Request, Response } from "express";
import { verificationDocumentModel } from "../models/verificationDocument.model.js";
import { verificationDocumentHistoryModel } from "../models/verificationDocumentHistory.model.js";
import { documentTypeModel } from "../models/documentType.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { uploadFile } from "../services/storage.service.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import type { UpdateDocumentStatusInput } from "../schemas/verification.schema.js";

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
    uploaded.storageDriver,
    expiresAt,
  );

  sendCreated(res, "Document uploaded successfully", document);
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
  await recalculateDriverVerificationStatus(document.userId);

  sendSuccess(res, "Document status updated successfully", updated);
}

export async function getDocumentHistory(req: Request, res: Response) {
  const { documentId } = req.validated.params as { documentId: string };

  const document = await verificationDocumentModel.findById(documentId);
  if (!document) {
    throw AppError.notFound(`Document not found: ${documentId}`);
  }

  const history = await verificationDocumentHistoryModel.getDocumentHistory(documentId);

  sendSuccess(res, "Document history retrieved successfully", history);
}

export async function listPendingDocuments(_req: Request, res: Response) {
  const pending = await verificationDocumentModel.getPendingDocumentsWithDetails();
  sendSuccess(res, "Pending documents retrieved", pending);
}

// Helper: Recalculate driver verification status based on document statuses
async function recalculateDriverVerificationStatus(userId: string): Promise<void> {
  const documents = await verificationDocumentModel.getDocumentsByUserId(userId);

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
    newStatus = "approved";
  }

  const driverProfile = await driverProfileModel.findById(userId);
  if (driverProfile && driverProfile.verificationStatus !== newStatus) {
    await driverProfileModel.updateVerificationStatus(userId, newStatus);
  }
}
