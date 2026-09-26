import { errorResponse, successResponse, registry } from "./registry.js";
import { z } from "zod";
import {
  verificationDocumentResponseSchema,
  verificationDocumentWithHistorySchema,
  uploadParamsSchema,
  updateDocumentStatusSchema,
  verificationDocumentHistoryResponseSchema,
} from "../schemas/verification.schema.js";
import { idParamsSchema } from "../schemas/common.schema.js";

registry.registerPath({
  method: "post",
  path: "/driver/verification/{documentTypeId}",
  tags: ["Driver Verification"],
  summary: "Upload a verification document",
  description:
    "Driver submits a verification document (ID, license, insurance, etc). Returns 409 if already submitted.",
  request: {
    params: uploadParamsSchema,
  },
  responses: {
    201: successResponse("Document uploaded successfully", verificationDocumentResponseSchema),
    400: errorResponse("Invalid document type or validation error"),
    401: errorResponse("Missing or invalid access token"),
    409: errorResponse("Document of this type already submitted"),
  },
});

registry.registerPath({
  method: "get",
  path: "/driver/verification",
  tags: ["Driver Verification"],
  summary: "Get driver's verification documents",
  description:
    "Retrieve all verification documents submitted by the authenticated driver, each with its complete status change history.",
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
  path: "/admin/verification/{documentId}",
  tags: ["Admin - Verification"],
  summary: "Update document verification status (admin)",
  description: "Admin approves, rejects, or leaves notes on a verification document.",
  request: {
    params: idParamsSchema,
    body: {
      content: { "application/json": { schema: updateDocumentStatusSchema } },
    },
  },
  responses: {
    200: successResponse("Document status updated successfully", verificationDocumentResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: update on roles"),
    404: errorResponse("Document not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/verification/pending",
  tags: ["Admin - Verification"],
  summary: "List pending verification documents (admin)",
  description: "Retrieve all documents awaiting or under review, with driver details.",
  responses: {
    200: successResponse(
      "Pending documents retrieved",
      z.array(verificationDocumentResponseSchema),
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on roles"),
  },
});

registry.registerPath({
  method: "get",
  path: "/verification/{documentId}/history",
  tags: ["Driver Verification"],
  summary: "Get document status change history",
  description:
    "Retrieve the full audit history of a verification document, showing all status changes, who made them, and why.",
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: successResponse(
      "Document history retrieved successfully",
      z.array(verificationDocumentHistoryResponseSchema),
    ),
    401: errorResponse("Missing or invalid access token"),
    404: errorResponse("Document not found"),
  },
});
