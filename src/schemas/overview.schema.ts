import { z } from "zod";

export const overviewQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .meta({ description: "Days of trip activity to return, ending today (UTC), 1-30 (default 7)" }),
});

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

const statTrendSchema = z.object({
  direction: z.enum(["up", "down"]).meta({ description: "up when today is at or above yesterday" }),
  value: z.string().meta({ description: "Change since yesterday, as a percentage", example: "+12.5%" }),
});

export const overviewResponseSchema = z.object({
  stats: z.object({
    activeRiders: z.number().int().meta({ description: "Active, non-deleted rider accounts" }),
    activeCarOwners: z.number().int().meta({ description: "Active, non-deleted driver accounts" }),
    tripsToday: z.number().int().meta({ description: "Trips completed today (UTC)" }),
    revenue: z.number().meta({
      description: "Platform fee plus booking fee on trips completed today, in GHS",
      example: 182.4,
    }),
    openIncidents: z.number().int().meta({ description: "SOS incidents not yet resolved or cancelled" }),
    pendingVerification: z.number().int().meta({ description: "Documents pending or under review" }),
    openTickets: z.number().int().meta({ description: "Support tickets open, in progress or awaiting the user" }),
  }),
  trends: z
    .object({
      activeRiders: statTrendSchema,
      activeCarOwners: statTrendSchema,
      tripsToday: statTrendSchema,
      revenue: statTrendSchema,
    })
    .meta({
      description:
        "Today against yesterday: for riders and car owners, the active count now against the accounts that existed before today; for trips and revenue, today's completed trips against yesterday's",
    }),
  tripActivity: z
    .array(
      z.object({
        date: z.iso.date().meta({ example: "2026-10-07" }),
        completed: z.number().int().meta({ description: "Trips completed that day" }),
        cancelled: z.number().int().meta({ description: "Trips cancelled that day" }),
      }),
    )
    .meta({ description: "One entry per day, oldest first, ending today (UTC); days with no trips are 0" }),
  verificationQueue: z
    .array(
      z.object({
        label: z.enum(["driver", "vehicle", "insurance"]).meta({
          description:
            "driver: national ID and driver's licence; vehicle: registration and roadworthiness; insurance",
        }),
        count: z.number().int(),
      }),
    )
    .meta({ description: "Documents pending or under review, always all three labels" }),
  recentActions: z
    .array(
      z.object({
        id: z.uuid().meta({ description: "Activity log entry id" }),
        actorId: z.uuid().nullable(),
        actorName: z.string().nullable(),
        module: z.string().meta({ example: "verification" }),
        action: z.string().meta({ example: "verification.approve" }),
        description: z.string(),
        targetType: z.string().nullable(),
        targetId: z.string().nullable(),
        tone: z.enum(["success", "danger"]).meta({
          description: "danger for deletes, suspensions, rejections, cancellations and revocations",
        }),
        createdAt: z.iso.datetime(),
      }),
    )
    .meta({ description: "The 20 newest successful changes (no reads), newest first" }),
});

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
