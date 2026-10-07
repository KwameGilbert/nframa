import { z } from "zod";
import { MAX_ATTACHMENTS } from "../config/supportAttachments.js";
import { SUPPORT_PRIORITIES } from "./supportCategory.schema.js";

export const SUPPORT_STATUSES = [
  "open",
  "inProgress",
  "awaitingUser",
  "resolved",
  "closed",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const ACTIVE_SUPPORT_STATUSES: SupportStatus[] = ["open", "inProgress", "awaitingUser"];

// A query param that may be sent once or repeated (?status=open&status=resolved), always read as a list.
export function oneOrMany<T extends z.ZodType>(item: T) {
  return z
    .union([item, z.array(item).min(1).max(10)])
    .transform((value) => [value].flat() as z.output<T>[]);
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
  transactionId: z
    .uuid()
    .optional()
    .meta({ description: "A wallet transaction of yours this is about" }),
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

const searchSchema = z.string().trim().min(2).max(200).optional().meta({
  description:
    'Search: a ticket code (ST-7KQ2MX, 7kq2mx), words from the subject or messages (stemmed, word starts match, small typos forgiven), or "an exact phrase", either OR other, -excluded',
  example: "refund",
});

export const listMyTicketsQuerySchema = z.object({
  status: oneOrMany(z.enum(SUPPORT_STATUSES))
    .optional()
    .meta({ description: "Only tickets in these statuses; repeat the parameter for several" }),
  tripId: z.uuid().optional().meta({ description: "Only tickets about this trip" }),
  q: searchSchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListMyTicketsQuery = z.infer<typeof listMyTicketsQuerySchema>;

export const rateTicketSchema = z.object({
  rating: z.number().int().min(1).max(5).meta({ description: "1 (poor) to 5 (great)", example: 5 }),
  comment: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .optional()
    .meta({ example: "Sorted out quickly, thanks." }),
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

// Chat.

export const messageParamsSchema = z.object({ id: z.uuid(), messageId: z.uuid() });

export const postMessageSchema = z.object({
  body: messageSchema
    .optional()
    .meta({ description: "The text. Required unless at least one file is attached" }),
  replyToMessageId: z.uuid().optional().meta({ description: "The message this one quotes" }),
});

export type PostMessageInput = z.infer<typeof postMessageSchema>;

export const postMessageMultipartSchema = postMessageSchema.extend({
  attachments: z
    .array(z.string().meta({ format: "binary" }))
    .max(MAX_ATTACHMENTS)
    .optional()
    .meta({ description: "Up to 5 files; repeat the attachments field once per file" }),
});

const seqSchema = z.coerce.number().int().min(1);

export const listMessagesQuerySchema = z
  .object({
    before: seqSchema.optional().meta({ description: "Older than this seq (scrolling up)" }),
    after: seqSchema.optional().meta({ description: "Newer than this seq (catching up)" }),
    around: seqSchema
      .optional()
      .meta({ description: "Centred on this seq (jumping to a search hit)" }),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    attachmentKind: z
      .enum(["image", "video", "audio", "document"])
      .optional()
      .meta({ description: "Only messages carrying this kind of file (a media gallery)" }),
  })
  .refine((q) => [q.before, q.after, q.around].filter((v) => v !== undefined).length <= 1, {
    message: "Use only one of before, after and around",
  });

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

const messageViewSchema = z.object({
  id: z.uuid(),
  seq: z
    .number()
    .int()
    .meta({ description: "Orders the timeline; use it for cursors and read markers" }),
  kind: z.enum(["message", "note", "event"]),
  from: z.enum(["user", "support", "system"]),
  senderName: z
    .string()
    .nullable()
    .meta({ description: "An agent's first name (users) or full name (staff)" }),
  body: z.string().nullable(),
  attachments: z.array(attachmentSchema),
  replyToMessageId: z.uuid().nullable(),
  event: z
    .object({ type: z.string(), data: z.record(z.string(), z.unknown()) })
    .nullable()
    .meta({ description: "For kind event: what changed (from, to, reason, rating)" }),
  deleted: z.boolean(),
  removedBy: z.enum(["user", "support"]).nullable().meta({ description: "Who deleted it" }),
  internal: z
    .boolean()
    .optional()
    .meta({ description: "Staff only: true for notes and events the user never sees" }),
  createdAt: z.iso.datetime(),
});

export const messagePageResponseSchema = z.object({
  items: z.array(messageViewSchema).meta({ description: "Oldest first" }),
  hasMoreBefore: z.boolean(),
  hasMoreAfter: z.boolean(),
  readMarkers: z.object({
    user: z.number().int().nullable().meta({ description: "The last seq the user has read" }),
    staff: z.number().int().nullable().meta({ description: "The last seq support has read" }),
  }),
});

export const postedMessageResponseSchema = z.object({
  message: messageViewSchema,
  ticket: z.object({ id: z.uuid(), status: supportStatusSchema }).passthrough(),
});

export const readResponseSchema = z.object({ lastReadSeq: z.number().int() });

// Staff.

export const SUPPORT_SORTS = ["queue", "relevance", "newest", "oldest", "lastActivity"] as const;

export const adminListTicketsQuerySchema = z.object({
  status: oneOrMany(z.enum(SUPPORT_STATUSES)).optional(),
  priority: oneOrMany(z.enum(SUPPORT_PRIORITIES)).optional(),
  categoryId: oneOrMany(z.uuid()).optional(),
  rating: oneOrMany(z.coerce.number().int().min(1).max(5)).optional(),
  assignedTo: z
    .union([z.enum(["me", "unassigned"]), z.uuid()])
    .optional()
    .meta({ description: "me, unassigned, or an admin's user id" }),
  raiserRole: z.enum(["rider", "driver"]).optional(),
  userId: z.uuid().optional().meta({ description: "Only this rider's or driver's tickets" }),
  tripId: z.uuid().optional(),
  needsReply: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .meta({
      description: "true: the last message came from the user (they are waiting on support)",
    }),
  from: z.iso
    .date()
    .optional()
    .meta({ description: "Opened on or after this day (YYYY-MM-DD, UTC)" }),
  to: z.iso
    .date()
    .optional()
    .meta({ description: "Opened on or before this day (YYYY-MM-DD, UTC)" }),
  q: searchSchema,
  sort: z.enum(SUPPORT_SORTS).optional().meta({
    description:
      "queue (default without q): active tickets first, then by priority, then the longest waiting. relevance (default with q): best match first. newest / oldest: by when opened. lastActivity: latest message first",
  }),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminListTicketsQuery = z.infer<typeof adminListTicketsQuerySchema>;

export const updateTicketSchema = z
  .object({
    status: z.enum(SUPPORT_STATUSES),
    priority: z.enum(SUPPORT_PRIORITIES),
    categoryId: z.uuid(),
    subject: subjectSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const assignTicketSchema = z
  .object({
    adminId: z.uuid().optional().meta({
      description: "The admin to give it to (their user id); leave out to take it yourself",
    }),
  })
  .optional()
  .default({});

export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

export const adminCreateTicketSchema = createTicketSchema.extend({
  userId: z.uuid().meta({ description: "The rider or driver the ticket is for" }),
  message: messageSchema.optional().meta({
    description: "Your first message to them. Required unless at least one file is attached",
  }),
  priority: z
    .enum(SUPPORT_PRIORITIES)
    .optional()
    .meta({ description: "Defaults to the category's priority" }),
});

export type AdminCreateTicketInput = z.infer<typeof adminCreateTicketSchema>;

export const adminCreateTicketMultipartSchema = adminCreateTicketSchema.extend({
  attachments: createTicketMultipartSchema.shape.attachments,
});

const lastMessageSchema = z
  .object({
    id: z.uuid(),
    from: z.enum(["user", "support"]),
    preview: z
      .string()
      .nullable()
      .meta({ description: "The first 120 characters; null for files only" }),
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
  reopenUntil: z.iso.datetime().nullable().meta({
    description: "For a resolved ticket: replying before this reopens it; after it, it closes",
  }),
});

const matchedMessageSchema = z
  .object({
    id: z.uuid(),
    seq: z
      .number()
      .int()
      .meta({ description: "Open the conversation with around=<seq> to jump to it" }),
    snippet: z.string().meta({ description: "Plain text around the match" }),
    internal: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .nullable()
  .meta({ description: "With q: the latest message that matched, if any" });

export const userTicketListResponseSchema = z.object({
  items: z.array(userTicketResponseSchema.extend({ matchedMessage: matchedMessageSchema })),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});

const personSchema = z.object({ id: z.uuid(), fullName: z.string().nullable() }).nullable();

export const staffTicketResponseSchema = z.object({
  id: z.uuid(),
  code: z.string().meta({ example: "ST-7KQ2MX" }),
  subject: z.string(),
  status: supportStatusSchema,
  priority: z.enum(SUPPORT_PRIORITIES),
  category: z.object({ id: z.uuid(), name: z.string() }),
  raiser: z.object({
    id: z.uuid(),
    fullName: z.string().nullable(),
    role: z.enum(["rider", "driver"]),
  }),
  assignee: personSchema.meta({ description: "The agent on it; null while unassigned" }),
  assignedAt: z.iso.datetime().nullable(),
  createdBy: personSchema.meta({
    description: "The agent who opened it on the user's behalf, if any",
  }),
  tripId: z.uuid().nullable(),
  transactionId: z.uuid().nullable(),
  payoutId: z.uuid().nullable(),
  relatedTicketId: z.uuid().nullable(),
  firstResponseAt: z.iso.datetime().nullable(),
  lastMessageAt: z.iso.datetime(),
  lastMessageSide: z.enum(["user", "staff"]).nullable().meta({
    description: "user: they are waiting on support",
  }),
  unreadCount: z.number().int().meta({ description: "User messages no agent has read yet" }),
  lastMessage: lastMessageSchema,
  rating: z.number().int().nullable(),
  ratingComment: z.string().nullable(),
  ratedAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  detachedAt: z.iso.datetime().nullable().meta({
    description:
      "Set when the raiser's phone number went to a new person: they no longer see this ticket",
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const countsSchema = z.object({
  open: z.number().int(),
  inProgress: z.number().int(),
  awaitingUser: z.number().int(),
  resolved: z.number().int(),
  closed: z.number().int(),
  unassigned: z.number().int().meta({ description: "Active tickets nobody has" }),
  mine: z.number().int().meta({ description: "Active tickets assigned to the caller" }),
  needsReply: z
    .number()
    .int()
    .meta({ description: "Active tickets whose last message is the user's" }),
});

export const staffTicketListResponseSchema = userTicketListResponseSchema.extend({
  items: z.array(staffTicketResponseSchema.extend({ matchedMessage: matchedMessageSchema })),
  stats: countsSchema.meta({
    description: "Counts over the whole queue (not the filters), for tabs",
  }),
});

export const staffTicketDetailResponseSchema = staffTicketResponseSchema.extend({
  raiser: z.object({
    id: z.uuid(),
    fullName: z.string().nullable(),
    role: z.enum(["rider", "driver"]),
    phoneNumber: z.string().nullable().meta({ example: "+233241234567" }),
    email: z.string().nullable(),
    status: z.string().meta({ description: "The account's status (active, suspended)" }),
    deleted: z.boolean(),
  }),
  trip: z
    .object({
      id: z.uuid(),
      status: z.string(),
      tripDate: z.string(),
      pickupAddress: z.string(),
      dropoffAddress: z.string(),
      totalAmount: z.number(),
    })
    .nullable(),
  transaction: z
    .object({
      id: z.uuid(),
      type: z.string(),
      direction: z.string(),
      amount: z.number(),
      status: z.string(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  payout: z
    .object({ id: z.uuid(), amount: z.number(), status: z.string(), createdAt: z.iso.datetime() })
    .nullable(),
  relatedTicket: z
    .object({ id: z.uuid(), code: z.string(), subject: z.string(), status: supportStatusSchema })
    .nullable(),
  history: z.object({
    totalTickets: z.number().int().meta({ description: "Every ticket this person has raised" }),
    activeTickets: z.number().int(),
  }),
});

export const assigneeResponseSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable(),
  department: z.string().nullable(),
  openTickets: z.number().int().meta({ description: "Active tickets assigned to them" }),
});

export const staffTicketChangeResponseSchema = staffTicketResponseSchema;
