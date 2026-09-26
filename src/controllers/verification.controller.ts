import type { Request, Response } from "express";
import { verificationDocumentModel } from "../models/verificationDocument.model.js";
import { documentTypeModel } from "../models/documentType.model.js";
import { driverProfileModel } from "../models/driverProfile.model.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import type { UpdateDocumentStatusInput } from "../schemas/verification.schema.js";

// TODO: Replace with actual S3 upload when file storage is set up.
// For now, mock S3 path generation for testing.
function generateMockS3Url(userId: string, documentTypeId: number, fileName: string): string {
  return `s3://nframa-verification/${userId}/${documentTypeId}/${Date.now()}-${fileName}`;
}

export async function uploadVerificationDocument(req: Request, res: Response) {
  if (!req.auth?.id) {
    throw AppError.unauthorized();
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

  // TODO: Handle actual file upload from req.file (multipart/form-data)
  // For now, accept fileUrl in request body for testing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileUrl = (req.validated.body as any).fileUrl || generateMockS3Url(userId, typeId, "document");

  const expiresAt = docType.hasExpiry ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : undefined;

  const document = await verificationDocumentModel.uploadDocument(
    userId,
    typeId,
    fileUrl,
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

  sendSuccess(res, "Documents retrieved successfully", documents);
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

  // Recalculate driver verification status
  await recalculateDriverVerificationStatus(document.userId);

  sendSuccess(res, "Document status updated successfully", updated);
}

export async function listPendingDocuments(req: Request, res: Response) {
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
