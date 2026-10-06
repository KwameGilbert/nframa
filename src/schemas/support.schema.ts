import { z } from "zod";
import { MAX_ATTACHMENTS } from "../config/supportAttachments.js";

export const SUPPORT_STATUSES = ["open", "inProgress", "awaitingUser", "resolved", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const ACTIVE_SUPPORT_STATUSES: SupportStatus[] = ["open", "inProgress", "awaitingUser"];

// A query param that may be sent once or repeated (?status=open&status=resolved), always read as a list.
export function oneOrMany<T extends z.ZodType>(item: T) {
  return z.union([item, z.array(item).min(1).max(10)]).transform((value) => [value].flat() as z.output<T>[]);
}

export const supportStatusSchema = z.enum(SUPPORT_STATUSES).meta({
  description:
    "open: waiting for an agent. inProgress: an agent has it. awaitingUser: support replied and waits for you. resolved: done, but a reply within the reopen window reopens it. closed: final; open a new ticket instead",
  example: "open",
});

export const ticketParamsSchema = z.object({ id: z.uuid() });

const subjectSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .meta({ description: "A short summary", example: "Charged twice for one trip" });
const messageSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .meta({ example: "I was charged GHS 25 twice for this morning's trip." });

export const createTicketSchema = z.object({
  categoryId: z.uuid().meta({ description: "One of GET /support/categories" }),
  subject: subjectSchema,
  message: messageSchema
    .optional()
    .meta({ description: "The first message. Required unless at least one file is attached" }),
  tripId: z.uuid().optional().meta({ description: "A trip of yours this is about" }),
  transactionId: z.uuid().optional().meta({ description: "A wallet transaction of yours this is about" }),
  payoutId: z.uuid().optional().meta({ description: "A payout of yours (drivers) this is about" }),
  relatedTicketId: z
    .uuid()
    .optional()
    .meta({ description: "An earlier ticket of yours this follows on from, e.g. one that closed" }),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const createTicketMultipartSchema = createTicketSchema.extend({
  attachments: z
    .array(z.string().meta({ format: "binary" }))
    .max(MAX_ATTACHMENTS)
    .optional()
    .meta({ description: "Up to 5 files; repeat the attachments field once per file" }),
});

export const listMyTicketsQuerySchema = z.object({
  status: oneOrMany(z.enum(SUPPORT_STATUSES))
    .optional()
    .meta({ description: "Only tickets in these statuses; repeat the parameter for several" }),
  tripId: z.uuid().optional().meta({ description: "Only tickets about this trip" }),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListMyTicketsQuery = z.infer<typeof listMyTicketsQuerySchema>;

export const rateTicketSchema = z.object({
  rating: z.number().int().min(1).max(5).meta({ description: "1 (poor) to 5 (great)", example: 5 }),
  comment: z.string().trim().min(1).max(1000).optional().meta({ example: "Sorted out quickly, thanks." }),
});

export type RateTicketInput = z.infer<typeof rateTicketSchema>;

export const attachmentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["image", "video", "audio", "document"]),
  fileUrl: z.url(),
  thumbnailUrl: z.url().nullable().meta({ description: "A video's poster image" }),
  mimeType: z.string().meta({ example: "image/jpeg" }),
  fileName: z.string().meta({ example: "receipt.pdf" }),
  sizeBytes: z.number().int(),
  durationSeconds: z.number().int().nullable().meta({ description: "Video and audio only" }),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

const lastMessageSchema = z
  .object({
    id: z.uuid(),
    from: z.enum(["user", "support"]),
    preview: z.string().nullable().meta({ description: "The first 120 characters; null for files only" }),
    attachmentKind: z.enum(["image", "video", "audio", "document"]).nullable(),
    deleted: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .nullable();

export const userTicketResponseSchema = z.object({
  id: z.uuid(),
  code: z.string().meta({ description: "Quote it when talking to support", example: "ST-7KQ2MX" }),
  subject: z.string(),
  status: supportStatusSchema,
  category: z.object({ id: z.uuid(), name: z.string() }),
  tripId: z.uuid().nullable(),
  transactionId: z.uuid().nullable(),
  payoutId: z.uuid().nullable(),
  relatedTicketId: z.uuid().nullable(),
  lastMessageAt: z.iso.datetime(),
  unreadCount: z.number().int().meta({ description: "Support messages you haven't read" }),
  lastMessage: lastMessageSchema,
  rating: z.number().int().nullable(),
  ratingComment: z.string().nullable(),
  ratedAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const userTicketDetailResponseSchema = userTicketResponseSchema.extend({
  canReply: z.boolean().meta({ description: "False once the ticket is closed" }),
  reopenUntil: z.iso
    .datetime()
    .nullable()
    .meta({ description: "For a resolved ticket: replying before this reopens it; after it, it closes" }),
});

export const userTicketListResponseSchema = z.object({
  items: z.array(userTicketResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});
