import { z } from "zod";

export const SOS_INCIDENT_STATUSES = [
  "triggered",
  "underReview",
  "servicesContacted",
  "resolved",
  "cancelledByUser",
  "cancelledByAdmin",
] as const;

export type SosIncidentStatus = (typeof SOS_INCIDENT_STATUSES)[number];

const latitudeSchema = z
  .number()
  .min(-90)
  .max(90)
  .meta({ description: "Degrees, -90 to 90", example: 5.60372 });

const longitudeSchema = z
  .number()
  .min(-180)
  .max(180)
  .meta({ description: "Degrees, -180 to 180", example: -0.17837 });

export const triggerSosSchema = z.object({
  tripId: z.uuid().optional().meta({ description: "Trip in progress when SOS was activated" }),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  address: z
    .string()
    .trim()
    .max(255)
    .optional()
    .meta({ example: "Liberation Road near Accra Mall, Accra" }),
  reason: z.string().trim().max(100).optional().meta({ example: "Personal/Medical Emergency" }),
});

export type TriggerSosInput = z.infer<typeof triggerSosSchema>;

export const cancelSosSchema = z
  .object({
    cancellationReason: z
      .string()
      .trim()
      .max(255)
      .optional()
      .meta({ example: "False alarm, button pressed by accident" }),
  })
  .default({});

export type CancelSosInput = z.infer<typeof cancelSosSchema>;

export const updateSosStatusSchema = z.object({
  status: z
    .enum(["underReview", "servicesContacted", "resolved"])
    .meta({ description: "Operational status", example: "underReview" }),
  resolutionNotes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .meta({ example: "Operations reached out to driver and dispatched emergency support." }),
});

export type UpdateSosStatusInput = z.infer<typeof updateSosStatusSchema>;

// Staff calling an alert off (a false alarm, a duplicate, a test) is its own action rather than a status the
// status route accepts: it can start from any status that is still in play, which "resolved" can't claim to be.
export const adminCancelSosSchema = z
  .object({
    resolutionNotes: z.string().trim().max(2000).optional().meta({
      description:
        "Why the alert is being cancelled. Staff only: the person who raised it never sees it",
      example: "Duplicate of the alert raised from the rider's other phone.",
    }),
  })
  .default({});

export type AdminCancelSosInput = z.infer<typeof adminCancelSosSchema>;

export const listSosIncidentsQuerySchema = z.object({
  status: z.enum(SOS_INCIDENT_STATUSES).optional(),
  userId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListSosIncidentsQuery = z.infer<typeof listSosIncidentsQuerySchema>;

export const sosIncidentParamsSchema = z.object({
  id: z.uuid(),
});

// Responses (docs only — see CLAUDE.md "API docs").

const incidentFields = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  tripId: z.uuid().nullable(),
  role: z.enum(["rider", "driver"]),
  status: z.enum(SOS_INCIDENT_STATUSES).meta({
    description:
      "triggered: raised, nobody has looked yet; underReview: operations is on it; servicesContacted: police/ambulance (112) have been called; resolved: closed by operations; cancelledByUser: the person cancelled before services were contacted; cancelledByAdmin: operations called the alert off (a false alarm or duplicate). The last three, with resolved, are final",
  }),
  latitude: z.number().meta({ example: 5.60372 }),
  longitude: z.number().meta({ example: -0.17837 }),
  address: z.string().nullable(),
  reason: z.string().nullable(),
  emergencyContactsSnapshot: z.array(z.record(z.string(), z.unknown())).nullable().meta({
    description: "The person's emergency contacts as they were when the alert was raised",
  }),
  resolvedAt: z.iso.datetime().nullable().meta({
    description:
      "When the alert stopped being in play: operations resolved it, or it was cancelled by the person or by operations. Null while it is still open",
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// What the person who raised the alert sees: not operations' internal notes or who handled it.
export const sosIncidentResponseSchema = incidentFields;

// What dispatchers see.
export const sosIncidentAdminResponseSchema = incidentFields.extend({
  resolvedByAdminId: z.uuid().nullable().meta({
    description:
      "The admin who resolved or cancelled it; null until then, and when the person cancelled it themselves",
  }),
  resolutionNotes: z.string().nullable().meta({
    description:
      "Operations' latest notes (or why they cancelled it), or the person's own reason for cancelling. Staff only",
  }),
  userFullName: z.string().nullable(),
  userPhone: z.string().nullable().meta({ example: "+233541436414" }),
});

export const sosIncidentListResponseSchema = z.object({
  items: z.array(sosIncidentAdminResponseSchema).meta({ description: "Newest first" }),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
});
