import { z } from "zod";

// Areas of the app an activity is filed under. Broader than the permission modules: sign-ins, drivers,
// riders and vehicles get their own so they can be filtered separately.
export const ACTIVITY_MODULES = [
  "auth",
  "users",
  "admin",
  "roles",
  "settings",
  "verification",
  "drivers",
  "riders",
  "vehicles",
  "commutes",
  "trips",
  "wallets",
  "payouts",
  "sos",
  "activityLogs",
] as const;

export type ActivityModule = (typeof ACTIVITY_MODULES)[number];

export const activityModuleSchema = z.enum(ACTIVITY_MODULES).meta({
  description:
    "Area of the app the action belongs to: auth (sign-up, sign-in, sign-out, passwords), users (rider/driver/admin accounts), admin (admin records), roles (roles and their permissions), settings, verification (documents and driver verification status), drivers, riders, vehicles, commutes (driver commutes), trips (rider trips on a commute), wallets (wallet top-ups and other money movements), payouts (drivers' payout methods), sos (SOS alerts and the safety desk), activityLogs (audit trail views)",
  example: "settings",
});

export const activityResultSchema = z.enum(["success", "failure"]).meta({
  description:
    "success: the action was carried out; failure: a failed sign-in or password reset (wrong password or code, inactive account)",
  example: "success",
});

export const listActivityLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .meta({ description: "Entries per page, 1-100 (default 20)" }),
    search: z.string().trim().min(1).optional().meta({
      description:
        "Case-insensitive text search across the action, description, path, target id, request body, and the actor's name and email",
      example: "fares.baseFare",
    }),
    actorId: z.uuid().optional().meta({ description: "Only actions by this user" }),
    actorRole: z
      .enum(["admin", "rider", "driver"])
      .optional()
      .meta({ description: "Only actions by accounts with this role" }),
    module: activityModuleSchema.optional(),
    action: z.string().trim().min(1).optional().meta({
      description: "Exact action code",
      example: "setting.update",
    }),
    targetType: z.string().trim().min(1).optional().meta({
      description: "Kind of record acted on",
      example: "setting",
    }),
    targetId: z.string().trim().min(1).optional().meta({
      description:
        "Id of the record acted on (a setting's key for settings). With targetType, this is the record's full history",
      example: "fares.baseFare",
    }),
    result: activityResultSchema.optional(),
    from: z.iso.datetime({ offset: true }).optional().meta({
      description: "Only entries at or after this time (ISO 8601)",
      example: "2026-09-01T00:00:00Z",
    }),
    to: z.iso.datetime({ offset: true }).optional().meta({
      description: "Only entries at or before this time (ISO 8601)",
      example: "2026-09-30T23:59:59Z",
    }),
  })
  .refine((q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to), {
    message: "from must not be after to",
    path: ["to"],
  });

export type ListActivityLogsQuery = z.infer<typeof listActivityLogsQuerySchema>;

// Just paging — the user is fixed by the route param (GET /users/:id/activity-logs or GET /activity-logs/user/:userId), not a filter here.
export const userActivityLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Page number, from 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: "Entries per page, 1-100 (default 20)" }),
});

export type UserActivityLogsQuery = z.infer<typeof userActivityLogsQuerySchema>;

export const activityLogUserParamsSchema = z.object({
  userId: z.uuid().meta({ description: "User ID to fetch activity logs for" }),
});

export type ActivityLogUserParams = z.infer<typeof activityLogUserParamsSchema>;

const snapshotSchema = z.record(z.string(), z.unknown()).nullable();

export const activityLogActorSchema = z
  .object({
    id: z.uuid(),
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    phoneCountryCode: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    role: z.enum(["admin", "rider", "driver"]),
  })
  .meta({ description: "The account that performed the action, as it is now" });

export const activityLogResponseSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable().meta({
    description:
      "Who did it; null when nobody had proven who they were (a failed sign-in, a sign-in or reset code request)",
  }),
  actor: activityLogActorSchema.nullable(),
  module: activityModuleSchema,
  action: z.string().meta({
    description: "Machine-readable action code, <resource>.<verb>",
    example: "setting.update",
  }),
  description: z.string().meta({ example: "Updated a setting" }),
  targetType: z.string().nullable().meta({
    description:
      "Kind of record acted on: setting, role, user, adminUser, driver, rider, vehicle, commute, trip, verificationDocument, transaction (wallet money). Sign-in and password activity targets the account (user)",
    example: "setting",
  }),
  targetId: z
    .string()
    .nullable()
    .meta({ description: "Id (or key) of the record acted on", example: "fares.baseFare" }),
  result: activityResultSchema,
  errorMessage: z.string().nullable().meta({
    description: "Why it failed, as the client was told; null on success",
    example: "Invalid email or password",
  }),
  method: z.string().meta({ example: "PATCH" }),
  path: z.string().meta({
    description: "Request path, without the query string",
    example: "/settings/fares.baseFare",
  }),
  requestBody: snapshotSchema.meta({
    description:
      'What was sent, with passwords, tokens and codes replaced by "[REDACTED]". Uploads show the file\'s name, type and size instead of its contents',
  }),
  before: snapshotSchema.meta({
    description:
      "The record before the change, in the same shape the endpoint returns it. Null for creations, failures, and sign-in/session actions",
  }),
  after: snapshotSchema.meta({
    description:
      "The record after the change — what the endpoint returned (the new account, for a sign-up). Null for deletions that return nothing, failures, and sign-in/session actions",
  }),
  changedFields: z
    .array(z.string())
    .nullable()
    .meta({
      description:
        "Fields whose value differs between before and after, as dotted paths (e.g. driver.verificationStatus); updatedAt is left out. Null when there's no before and after to compare",
      example: ["value"],
    }),
  ipAddress: z.string().nullable().meta({ example: "41.66.100.1" }),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable().meta({
    description:
      "The request's X-Request-Id, for finding the matching server log lines. One request can log several entries (a document review that also changes the driver's status)",
  }),
  createdAt: z.iso.datetime(),
});

export const activityLogListResponseSchema = z.object({
  items: z
    .array(activityLogResponseSchema)
    .meta({ description: "This page's entries, newest first" }),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
  stats: z
    .object({
      total: z.number().int(),
      success: z.number().int(),
      failure: z.number().int(),
      actors: z
        .number()
        .int()
        .meta({ description: "Distinct signed-in accounts among the matches" }),
    })
    .meta({ description: "Counts over every entry matching the filters, not just this page" }),
});
