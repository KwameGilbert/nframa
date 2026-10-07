import { z } from "zod";

export const REPORT_CATEGORIES = [
  "physicalAssault",
  "threatOrIntimidation",
  "sexualMisconduct",
  "unsafeDriving",
  "suspectedIntoxication",
  "harassment",
  "discrimination",
  "inappropriateBehavior",
  "vehicleMismatch",
  "propertyDamage",
  "fareOrPaymentDispute",
  "lateOrNoShow",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// Safety first: these jump the staff queue and tell the reporter to call 112 if they are in danger right now. The
// client never sends a severity, it follows from the category.
export const URGENT_REPORT_CATEGORIES: readonly ReportCategory[] = [
  "physicalAssault",
  "threatOrIntimidation",
  "sexualMisconduct",
  "unsafeDriving",
  "suspectedIntoxication",
];

export const REPORT_SEVERITIES = ["normal", "urgent"] as const;
export const REPORT_STATUSES = [
  "open",
  "underReview",
  "resolved",
  "dismissed",
  "withdrawn",
] as const;

export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const MAX_REPORT_EVIDENCE = 5;

const categorySchema = z.enum(REPORT_CATEGORIES).meta({
  description:
    "What happened. physicalAssault, threatOrIntimidation, sexualMisconduct, unsafeDriving and suspectedIntoxication are urgent safety categories and go to the top of staff's queue; harassment, discrimination, inappropriateBehavior, vehicleMismatch (the driver or car isn't the one in the app), propertyDamage, fareOrPaymentDispute, lateOrNoShow and other are handled in order",
  example: "harassment",
});

export const createReportSchema = z.object({
  category: categorySchema,
  description: z.string().trim().min(10).max(2000).meta({
    description:
      "What happened, in the reporter's own words. Only staff see it; the person reported is never told",
    example:
      "The driver kept asking for my number after I said no, and would not stop at my request.",
  }),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const tripReportsParamsSchema = z.object({
  tripId: z
    .uuid()
    .meta({ description: "The trip the report is about; the caller was its rider or driver" }),
});

export const reportParamsSchema = z.object({
  id: z.uuid(),
});

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const listMyReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  tripId: z.uuid().optional().meta({ description: "Only reports about this trip" }),
  ...pagination,
});

export type ListMyReportsQuery = z.infer<typeof listMyReportsQuerySchema>;

export const adminListReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  severity: z.enum(REPORT_SEVERITIES).optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
  reporterUserId: z.uuid().optional().meta({ description: "Only reports filed by this person" }),
  reportedUserId: z.uuid().optional().meta({ description: "Only reports about this person" }),
  tripId: z.uuid().optional(),
  from: z.iso.date().optional().meta({
    description: "Only reports filed on or after this day (YYYY-MM-DD, UTC)",
    example: "2026-10-01",
  }),
  to: z.iso.date().optional().meta({
    description: "Only reports filed on or before this day (YYYY-MM-DD, UTC)",
    example: "2026-10-31",
  }),
  ...pagination,
});

export type AdminListReportsQuery = z.infer<typeof adminListReportsQuerySchema>;

export const updateReportStatusSchema = z.object({
  status: z.enum(["underReview", "resolved", "dismissed"]).meta({
    description:
      "underReview: staff have picked it up. resolved: looked into and dealt with. dismissed: closed without further action. resolved and dismissed are final",
    example: "underReview",
  }),
  internalNotes: z.string().trim().max(2000).optional().meta({
    description:
      "Staff-only notes. Never shown to the reporter or the person reported; replaces earlier notes when given",
    example: "Called the driver; second report against him this month.",
  }),
  outcomeMessage: z.string().trim().max(1000).optional().meta({
    description:
      "What staff tell the reporter (shown in the app and emailed when the report is resolved or dismissed). Replaces an earlier message when given",
    example:
      "Thank you for reporting this. We have spoken to the driver and taken action on his account.",
  }),
});

export type UpdateReportStatusInput = z.infer<typeof updateReportStatusSchema>;

// Responses (docs only — see CLAUDE.md "API docs").

const evidenceSchema = z.object({
  fileUrl: z
    .url()
    .meta({ example: "https://res.cloudinary.com/demo/image/upload/nframa/reports/1.jpg" }),
});

const reportFields = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  reporterRole: z
    .enum(["rider", "driver"])
    .meta({ description: "Whether the reporter was the trip's rider or its driver" }),
  category: z.enum(REPORT_CATEGORIES),
  severity: z.enum(REPORT_SEVERITIES),
  description: z.string(),
  tripStatus: z.string().meta({
    description:
      "The trip's status when the report was filed, e.g. boarded for a report made during the ride",
    example: "boarded",
  }),
  evidence: z
    .array(evidenceSchema)
    .meta({ description: "Images attached when the report was filed, up to 5" }),
  status: z.enum(REPORT_STATUSES).meta({
    description:
      "open: waiting for staff. underReview: staff are on it. resolved / dismissed: closed by staff. withdrawn: the reporter took it back",
  }),
  outcomeMessage: z.string().nullable().meta({
    description: "What staff told the reporter when closing it; null until then",
  }),
  resolvedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "When staff resolved or dismissed it" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// What the person who filed it sees: never staff's notes, which admin handled it, or who was reported.
export const reportResponseSchema = reportFields;

export const reportAdminResponseSchema = reportFields.extend({
  reporterUserId: z.uuid(),
  reportedUserId: z.uuid(),
  internalNotes: z.string().nullable().meta({ description: "Staff-only notes" }),
  handledByAdminId: z.uuid().nullable().meta({
    description: "The admin who last moved it; null while nobody has",
  }),
});

export const reportAdminListItemSchema = reportAdminResponseSchema.extend({
  reporterName: z.string().nullable(),
  reportedName: z.string().nullable(),
});

const personSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable(),
  phone: z.string().nullable().meta({ example: "+233541436414" }),
  role: z.enum(["rider", "driver", "admin"]),
});

export const reportAdminDetailResponseSchema = reportAdminResponseSchema.extend({
  reporter: personSchema,
  reported: personSchema,
  trip: z.object({
    id: z.uuid(),
    status: z.string(),
    tripDate: z.string().meta({ example: "2026-10-05" }),
    pickupAddress: z.string(),
    dropoffAddress: z.string(),
    scheduledPickupAt: z.iso.datetime(),
    boardedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
  }),
  history: z
    .object({
      reporterFiled: z
        .number()
        .int()
        .meta({ description: "Reports the reporter has filed in total" }),
      reportedAgainst: z.number().int().meta({
        description: "Reports filed against the reported person in total, this one included",
      }),
      reportedUnresolved: z
        .number()
        .int()
        .meta({ description: "Of those, how many are still open or under review" }),
    })
    .meta({ description: "How the two people appear elsewhere, so repeat problems stand out" }),
});

const page = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

export const reportListResponseSchema = z.object({
  items: z.array(reportResponseSchema).meta({ description: "Newest first" }),
  pagination: page,
});

export const reportAdminListResponseSchema = z.object({
  items: z.array(reportAdminListItemSchema).meta({
    description: "Unresolved reports first, urgent before normal, then newest first",
  }),
  pagination: page,
});

// The create request as multipart/form-data (docs only: the body is validated by createReportSchema, the files by
// the upload middleware).
export const createReportMultipartSchema = createReportSchema.extend({
  evidence: z
    .array(z.string().meta({ format: "binary" }))
    .max(MAX_REPORT_EVIDENCE)
    .optional()
    .meta({
      description:
        "Up to 5 images (JPEG, PNG or WEBP, 5MB each); repeat the evidence field once per file",
    }),
});
