import { z } from "zod";

export const documentStatusSchema = z.enum(["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED", "EXPIRED"]).meta({
  description: "PENDING: submitted, awaiting review; UNDER_REVIEW: admin is reviewing; VERIFIED: approved; REJECTED: not accepted; EXPIRED: was verified but expired",
  example: "VERIFIED",
});

export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const uploadParamsSchema = z.object({
  documentTypeId: z.coerce.number().int().positive(),
});

export type UploadParamsInput = z.infer<typeof uploadParamsSchema>;

export const documentTypeSchema = z.object({
  id: z.number().int(),
  code: z.string().meta({ description: "Machine identifier like NATIONAL_ID, DRIVERS_LICENSE", example: "DRIVERS_LICENSE" }),
  name: z.string().meta({ example: "Driver's License" }),
  description: z.string().nullable(),
  hasExpiry: z.boolean().meta({ description: "Whether this document type expires and needs renewal" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type DocumentType = z.infer<typeof documentTypeSchema>;

export const verificationDocumentResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  documentTypeId: z.number().int(),
  fileUrl: z.string().url().meta({ description: "S3 path or public URL where the document is stored" }),
  status: documentStatusSchema,
  expiresAt: z.iso.datetime().nullable().meta({ description: "When this document expires (if applicable)" }),
  notes: z.string().nullable().meta({ description: "Admin notes: rejection reason, or other relevant info" }),
  uploadedAt: z.iso.datetime(),
  verifiedAt: z.iso.datetime().nullable(),
  verifiedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type VerificationDocument = z.infer<typeof verificationDocumentResponseSchema>;

export const uploadVerificationDocumentSchema = z.object({
  documentTypeId: z.number().int().meta({ description: "ID of the document type being submitted" }),
});

export type UploadVerificationDocumentInput = z.infer<typeof uploadVerificationDocumentSchema>;

export const updateDocumentStatusSchema = z
  .object({
    status: documentStatusSchema,
    notes: z.string().optional().meta({ description: "Admin notes: rejection reason or status comments" }),
  })
  .meta({ description: "Update a document's verification status (admin only)" });

export type UpdateDocumentStatusInput = z.infer<typeof updateDocumentStatusSchema>;
