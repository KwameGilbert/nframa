import { z } from "zod";
import { NOTIFICATION_TYPES, type NotificationType } from "../config/notificationTypes.js";

// Only the types that write an inbox row; push-only ones (driver arrived, staff desk alerts) can never be listed.
const INBOX_TYPES = (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).filter(
  (type) => NOTIFICATION_TYPES[type].inbox,
) as [NotificationType, ...NotificationType[]];

const typeSchema = z.enum(INBOX_TYPES).meta({
  description:
    "What it is about, e.g. trip.accepted, trip.cancelled, sos.statusChanged, report.statusChanged, wallet.topUp, account.passwordChanged. Only types that are kept in the inbox: push-only ones (trip.driverArrived, sos.deskAlert, report.deskUrgent) never are. Apps route a tap by type and the ids in data",
  example: "trip.accepted",
});

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // A string on purpose: z.coerce.boolean() would turn "false" into true.
  unread: z.enum(["true", "false"]).optional().meta({
    description: "true: only unread ones; false: only ones already read; leave out for both",
    example: "true",
  }),
  type: typeSchema.optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationParamsSchema = z.object({
  id: z.uuid(),
});

// Responses (docs only — see CLAUDE.md "API docs").

const unreadCountSchema = z.number().int().meta({
  description:
    "How many of the caller's notifications are unread after this call (for the app badge)",
  example: 3,
});

export const notificationResponseSchema = z.object({
  id: z.uuid(),
  type: typeSchema,
  title: z.string().meta({ example: "Trip accepted" }),
  body: z.string().meta({ example: "Your driver accepted your trip for Mon 5 Oct, 07:30." }),
  data: z.record(z.string(), z.string()).meta({
    description:
      "Ids only, for routing a tap: any of tripId, commuteId, tripDate, incidentId, reportId, transactionId, status. Never names, phone numbers, codes or text anyone typed",
    example: { tripId: "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34", tripDate: "2026-10-05" },
  }),
  readAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "When it was first marked read; null while unread" }),
  createdAt: z.iso.datetime(),
});

export const notificationListResponseSchema = z.object({
  items: z.array(notificationResponseSchema).meta({ description: "Newest first" }),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
  unreadCount: unreadCountSchema,
});

export const notificationReadResponseSchema = z.object({
  notification: notificationResponseSchema,
  unreadCount: unreadCountSchema,
});

export const notificationReadAllResponseSchema = z.object({
  updatedCount: z
    .number()
    .int()
    .meta({ description: "How many unread notifications this call marked read", example: 3 }),
  unreadCount: unreadCountSchema,
});

export const notificationDeleteResponseSchema = z.object({
  unreadCount: unreadCountSchema,
});
