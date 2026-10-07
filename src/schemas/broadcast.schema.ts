import { z } from "zod";

export const BROADCAST_AUDIENCES = ["riders", "drivers", "all"] as const;
export const BROADCAST_CHANNELS = ["inApp", "push", "sms", "email"] as const;
export const BROADCAST_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "cancelled",
  "failed",
] as const;

export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

const audienceSchema = z.enum(BROADCAST_AUDIENCES).meta({
  description: "Who gets it: riders, drivers (car owners), or all riders and drivers. Never staff",
  example: "drivers",
});

const channelsSchema = z
  .array(z.enum(BROADCAST_CHANNELS))
  .min(1)
  .refine((channels) => new Set(channels).size === channels.length, {
    message: "Each channel can only be listed once",
  })
  .meta({
    description:
      "inApp: a notice in the app's notification inbox. push: a push notification to the person's phones and browsers. sms: a text to their phone number. email: to their email address. People without a phone, an email or a registered device simply aren't reached on that channel",
    example: ["inApp", "push"],
  });

const titleSchema = z.string().trim().min(1).max(80).meta({
  description: "The headline: the push title, the email subject and the inbox title",
  example: "Accra–Tema route diversion on Monday",
});

const bodySchema = z.string().trim().min(1).max(2000).meta({
  description:
    "The message. Push notifications show the start of it; the inbox and email show all of it",
  example:
    "Because of road works on the motorway, Monday's morning commutes between Accra and Tema will use the Spintex Road. Expect pickups up to 10 minutes later than usual.",
});

const smsTextSchema = z.string().trim().min(1).max(1000).meta({
  description:
    'What an SMS says instead of "title: body". Whichever it is must fit in 3 SMS (459 plain characters, or 201 with emoji or non-Latin letters); a longer one is refused when the broadcast is saved with sms as a channel',
  example:
    "Nframa: Mon commutes Accra-Tema use Spintex Rd due to road works. Pickups up to 10 min later.",
});

export const broadcastParamsSchema = z.object({
  id: z.uuid().meta({ example: "5b1f0c7e-2d3a-4c8e-9f61-7a2b3c4d5e6f" }),
});

export type BroadcastParams = z.infer<typeof broadcastParamsSchema>;

// Always a draft: schedule it with POST /admin/broadcasts/:id/schedule.
export const createBroadcastSchema = z.object({
  title: titleSchema,
  body: bodySchema,
  smsText: smsTextSchema.optional(),
  audience: audienceSchema,
  channels: channelsSchema,
});

export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const updateBroadcastSchema = z
  .object({
    title: titleSchema.optional(),
    body: bodySchema.optional(),
    smsText: smsTextSchema.nullable().optional().meta({
      description: 'A new SMS text, or null to go back to "title: body"',
      example: "Nframa: Mon commutes Accra-Tema use Spintex Rd. Pickups up to 10 min later.",
    }),
    audience: audienceSchema.optional(),
    channels: channelsSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Send at least one field to change",
  });

export type UpdateBroadcastInput = z.infer<typeof updateBroadcastSchema>;

export const scheduleBroadcastSchema = z.object({
  scheduledFor: z.iso.datetime({ offset: true }).meta({
    description:
      "When to send it: an ISO 8601 date-time with its timezone, at least a minute from now and at most 90 days ahead. It goes out within a minute of this time",
    example: "2026-10-12T05:30:00Z",
  }),
});

export type ScheduleBroadcastInput = z.infer<typeof scheduleBroadcastSchema>;

export const listBroadcastsQuerySchema = z.object({
  status: z.enum(BROADCAST_STATUSES).optional(),
  audience: z.enum(BROADCAST_AUDIENCES).optional(),
  channel: z
    .enum(BROADCAST_CHANNELS)
    .optional()
    .meta({ description: "Only broadcasts that use this channel" }),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({ description: "Words in the title", example: "diversion" }),
  from: z.iso.date().optional().meta({
    description: "Only broadcasts created on or after this day (YYYY-MM-DD, UTC)",
    example: "2026-10-01",
  }),
  to: z.iso.date().optional().meta({
    description: "Only broadcasts created on or before this day (YYYY-MM-DD, UTC)",
    example: "2026-10-31",
  }),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListBroadcastsQuery = z.infer<typeof listBroadcastsQuerySchema>;

export const audiencePreviewQuerySchema = z.object({
  audience: audienceSchema,
});

export type AudiencePreviewQuery = z.infer<typeof audiencePreviewQuerySchema>;

// Responses (docs only — see CLAUDE.md "API docs").

export const smsBalanceResponseSchema = z.object({
  smsUnits: z.number().meta({
    description:
      "SMS units left on the provider account. One unit sends one SMS segment to one person, so an SMS broadcast costs about reachable.sms (from the audience preview) × smsSegments. Sign-in codes use the same units",
    example: 4820,
  }),
  mainBalance: z.string().meta({
    description: "The account's money balance as the provider reports it",
    example: "GHS 120.50",
  }),
});

const staffSchema = z
  .object({
    id: z.uuid(),
    fullName: z.string().nullable().meta({ example: "Kofi Boateng" }),
  })
  .nullable();

export const broadcastResponseSchema = z.object({
  id: z.uuid(),
  title: z.string().meta({ example: "Accra–Tema route diversion on Monday" }),
  body: z.string().meta({
    example:
      "Because of road works on the motorway, Monday's morning commutes between Accra and Tema will use the Spintex Road.",
  }),
  smsText: z.string().nullable().meta({ description: 'null: an SMS says "title: body"' }),
  audience: z.enum(BROADCAST_AUDIENCES),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).meta({ example: ["inApp", "push", "sms"] }),
  smsSegments: z.number().int().meta({
    description: "How many SMS each text is billed as (whether or not sms is a channel)",
    example: 1,
  }),
  status: z.enum(BROADCAST_STATUSES).meta({
    description:
      "draft: being written, editable. scheduled: will go out at scheduledFor; still editable and can be cancelled. sending: going out now. sent: delivered (sentAt). cancelled: a scheduled one called off. failed: couldn't be delivered. sending, sent, cancelled and failed can't be changed",
    example: "scheduled",
  }),
  scheduledFor: z.iso.datetime().nullable().meta({ example: "2026-10-12T05:30:00.000Z" }),
  startedAt: z.iso.datetime().nullable().meta({ description: "When sending began" }),
  sentAt: z.iso.datetime().nullable().meta({ description: "When it finished going out" }),
  cancelledAt: z.iso.datetime().nullable(),
  createdBy: staffSchema,
  updatedBy: staffSchema.meta({ description: "Who last edited, scheduled or cancelled it" }),
  cancelledBy: staffSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const broadcastListResponseSchema = z.object({
  items: z.array(broadcastResponseSchema),
  pagination: z.object({
    page: z.number().int().meta({ example: 1 }),
    limit: z.number().int().meta({ example: 20 }),
    totalItems: z.number().int().meta({ example: 42 }),
    totalPages: z.number().int().meta({ example: 3 }),
  }),
});

export const audiencePreviewResponseSchema = z.object({
  audience: z.enum(BROADCAST_AUDIENCES),
  recipients: z.number().int().meta({
    description: "Active riders/drivers in the audience: everyone an in-app notice reaches",
    example: 1240,
  }),
  reachable: z.object({
    inApp: z.number().int().meta({ example: 1240 }),
    push: z.number().int().meta({
      description: "People with at least one device that has opened the app recently",
      example: 1105,
    }),
    sms: z.number().int().meta({ description: "People with a phone number", example: 1198 }),
    email: z.number().int().meta({ description: "People with an email address", example: 860 }),
  }),
});
