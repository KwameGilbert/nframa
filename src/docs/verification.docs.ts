import { errorResponse, successResponse, registry } from "./registry.js";
import { z } from "zod";
import {
  documentTypeSchema,
  verificationDocumentResponseSchema,
  verificationDocumentWithHistorySchema,
  uploadParamsSchema,
  documentIdParamsSchema,
  updateDocumentStatusSchema,
  verificationDocumentHistoryResponseSchema,
  updateDriverVerificationStatusSchema,
} from "../schemas/verification.schema.js";
import { driverProfileParamsSchema } from "../schemas/driverProfile.schema.js";
import { driverWithRelationsResponseSchema } from "../schemas/driverProfile.schema.js";

registry.registerPath({
  method: "get",
  path: "/document-types",
  tags: ["Driver Verification"],
  summary: "List document types",
  description:
    "Reference data for building the upload UI: every document type a driver can be asked to submit, with whether it expires and whether it's required before the driver can be approved.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Document types retrieved successfully", z.array(documentTypeSchema)),
    401: errorResponse("Missing or invalid access token"),
  },
});

registry.registerPath({
  method: "post",
  path: "/driver/verification/{documentTypeId}",
  tags: ["Driver Verification"],
  summary: "Upload a verification document",
  description:
    "Driver submits a verification document (ID, license, insurance, etc) as multipart/form-data. Accepts JPEG, PNG, WEBP or PDF, up to 10MB. Returns 409 if already submitted (without a prior deletion); to resubmit after deleting, use DELETE /verification/{documentId} first.",
  security: [{ bearerAuth: [] }],
  request: {
    params: uploadParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              file: { type: "string", format: "binary", description: "The document file" },
            },
            required: ["file"],
          },
        },
      },
    },
  },
  responses: {
    201: successResponse("Document uploaded successfully", verificationDocumentResponseSchema),
    400: errorResponse("Invalid document type, missing/unsupported file, or file too large"),
    401: errorResponse("Missing or invalid access token"),
    409: errorResponse(
      "Document of this type already submitted",
      "You already submitted a Ghana Card. Delete it first to submit a new one.",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/driver/verification",
  tags: ["Driver Verification"],
  summary: "Get driver's verification documents",
  description:
    "Retrieve all verification documents submitted by the authenticated driver, each with its complete status change history.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Documents retrieved successfully",
      z.array(verificationDocumentWithHistorySchema),
    ),
    401: errorResponse("Missing or invalid access token"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/verification/document/{documentId}",
  tags: ["Document Verification"],
  summary: "Update document verification status",
  description:
    "Admin approves, rejects, or leaves notes on a verification document. The driver's overall status follows automatically — rejected if any document is rejected, expiring if any has expired, otherwise pending — but never becomes approved: once every document is verified the driver stays pending until an admin approves them through PATCH /admin/driver/{userId}/verification (an already-approved driver stays approved). Needs verification: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: documentIdParamsSchema,
    body: {
      content: { "application/json": { schema: updateDocumentStatusSchema } },
    },
  },
  responses: {
    200: successResponse(
      "Document status updated successfully",
      verificationDocumentResponseSchema,
    ),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: update on verification"),
    404: errorResponse(
      "Document not found",
      "Document not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/driver/verification/pending",
  tags: ["Document Verification"],
  summary: "List pending driver verification documents",
  description:
    "Retrieve all driver documents awaiting or under review, with driver details. Needs verification: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Pending documents retrieved",
      z.array(verificationDocumentResponseSchema),
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on verification"),
  },
});

registry.registerPath({
  method: "get",
  path: "/verification/{documentId}/history",
  tags: ["Driver Verification"],
  summary: "Get document status change history",
  description:
    "Retrieve the full audit history of a verification document, showing all status changes, who made them, and why. The document's own driver can see it; anyone else needs verification: read.",
  security: [{ bearerAuth: [] }],
  request: {
    params: documentIdParamsSchema,
  },
  responses: {
    200: successResponse(
      "Document history retrieved successfully",
      z.array(verificationDocumentHistoryResponseSchema),
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on verification"),
    404: errorResponse(
      "Document not found",
      "Document not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/verification/{documentId}",
  tags: ["Driver Verification"],
  summary: "Delete a verification document",
  description:
    "Driver deletes their own verification document (soft delete, preserving history), or an admin with verification: delete can delete any driver's document. The document can later be resubmitted via POST /driver/verification/{documentTypeId}.",
  security: [{ bearerAuth: [] }],
  request: {
    params: documentIdParamsSchema,
  },
  responses: {
    200: successResponse("Document deleted successfully"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Caller is neither the document's owner nor has verification: delete"),
    404: errorResponse(
      "Document not found",
      "Document not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    409: errorResponse("Document is already deleted", "Document is already deleted"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/driver/{userId}/verification",
  tags: ["Driver Verification Admin"],
  summary: "Update driver verification status",
  description:
    "Admin sets a driver's overall verification status (unverified, pending, approved, rejected, or expiring) independently from individual document reviews. This is the only way a driver becomes approved, and only once they've submitted a document of every required type (see GET /document-types, isRequired) and every document they've submitted is verified and not expired. Needs verification: update. Returns the full driver profile with relations.",
  security: [{ bearerAuth: [] }],
  request: {
    params: driverProfileParamsSchema,
    body: {
      content: { "application/json": { schema: updateDriverVerificationStatusSchema } },
    },
  },
  responses: {
    200: successResponse(
      "Driver verification status updated successfully",
      driverWithRelationsResponseSchema,
    ),
    400: errorResponse(
      "Validation error, or cannot approve: a required document type is missing (named in the error), a document isn't verified yet, or a document has expired",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: update on verification"),
    404: errorResponse(
      "Driver profile not found",
      "Driver profile not found for user: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});
