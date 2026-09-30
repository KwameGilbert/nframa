import { z } from "zod";
import { registry } from "./registry.js";

/**
 * Socket.IO Event Schemas
 *
 * These are push-only events emitted by the server to authenticated clients.
 * Events are registered as OpenAPI components (schemas) for reference in Swagger UI,
 * under the "Real-Time Events" section.
 *
 * Connection: io(baseUrl, { auth: { token: accessToken }, transports: ["websocket"] })
 * Token expires after 15 minutes — refresh via POST /auth/refresh before reconnecting.
 */

// ============================================================================
// User & Account Events
// ============================================================================

const userSuspendedPayloadSchema = z.object({
  reason: z.string().nullable().meta({
    description: "The reason the admin provided for suspension (nullable)",
    example: "Repeated ride cancellations"
  }),
});

registry.registerComponent("schemas", "UserSuspendedEvent", userSuspendedPayloadSchema);

// ============================================================================
// Driver Verification Events
// ============================================================================

const driverVerificationStatusChangedPayloadSchema = z.object({
  userId: z.string().uuid().meta({
    description: "Driver's user ID",
    example: "550e8400-e29b-41d4-a716-446655440000"
  }),
  verificationStatus: z.enum(["unverified", "pending", "approved", "rejected", "expiring"]).meta({
    description: "New verification status",
    example: "approved"
  }),
  previousStatus: z.enum(["unverified", "pending", "approved", "rejected", "expiring"]).meta({
    description: "Previous verification status",
    example: "pending"
  }),
});

registry.registerComponent(
  "schemas",
  "DriverVerificationStatusChangedEvent",
  driverVerificationStatusChangedPayloadSchema
);

// ============================================================================
// Trip Request & Lifecycle Events
// ============================================================================

const tripEventBaseSchema = z.object({
  tripId: z.string().uuid().meta({
    description: "Trip ID",
    example: "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60"
  }),
  commuteId: z.string().uuid().meta({
    description: "Commute ID this trip belongs to",
    example: "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"
  }),
  tripDate: z.string().date().meta({
    description: "Service date (Ghana time, UTC+0)",
    example: "2026-10-01"
  }),
  status: z.string().meta({
    description: "Trip status after this event",
    example: "accepted"
  }),
});

// trip:requested — sent to driver when rider requests a seat
const tripRequestedPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("pending").or(z.literal("accepted")).meta({
    description: "pending if driver must answer; accepted if driver auto-accepts bookings",
    example: "pending"
  }),
});

registry.registerComponent("schemas", "TripRequestedEvent", tripRequestedPayloadSchema);

// trip:cancelled — sent to the party that didn't cancel
const tripCancelledPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("cancelled"),
  cancelledBy: z.enum(["rider", "driver"]).meta({
    description: "Who cancelled the trip",
    example: "rider"
  }),
  reason: z.string().nullable().meta({
    description: "Cancellation reason provided by the party who cancelled",
    example: "Plans changed"
  }),
});

registry.registerComponent("schemas", "TripCancelledEvent", tripCancelledPayloadSchema);

// trip:accepted — sent to rider when driver accepts their request
const tripAcceptedPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("accepted"),
});

registry.registerComponent("schemas", "TripAcceptedEvent", tripAcceptedPayloadSchema);

// trip:declined — sent to rider when driver declines their pending request
const tripDeclinedPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("declined"),
  reason: z.string().nullable().meta({
    description: "Decline reason provided by the driver (if any)",
    example: "Car is full of family today"
  }),
});

registry.registerComponent("schemas", "TripDeclinedEvent", tripDeclinedPayloadSchema);

// trip:driver_arrived — sent to rider when driver marks arrival at pickup
const tripDriverArrivedPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("accepted"),
  arrivedAt: z.string().datetime().meta({
    description: "Timestamp when driver arrived (wait time counts from here)",
    example: "2026-10-01T07:29:40.000Z"
  }),
});

registry.registerComponent("schemas", "TripDriverArrivedEvent", tripDriverArrivedPayloadSchema);

// trip:boarded — sent to rider when driver scans boarding code (rider money is now charged)
const tripBoardedPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("boarded"),
  boardedAt: z.string().datetime().meta({
    description: "Timestamp when rider was scanned and boarded",
    example: "2026-10-01T07:42:05.000Z"
  }),
  waitMinutes: z.number().int().meta({
    description: "Minutes the driver waited before boarding (0 if no arrival mark)",
    example: 12
  }),
  waitCharge: z.number().meta({
    description: "Currency amount charged for wait time, in addition to fare",
    example: 3.50
  }),
});

registry.registerComponent("schemas", "TripBoardedEvent", tripBoardedPayloadSchema);

// trip:completed — sent to rider when driver completes the trip (driver is paid)
const tripCompletedPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("completed"),
  completedAt: z.string().datetime().meta({
    description: "Timestamp when trip was completed",
    example: "2026-10-01T08:05:31.000Z"
  }),
});

registry.registerComponent("schemas", "TripCompletedEvent", tripCompletedPayloadSchema);

// trip:no_show — sent to rider when driver reports they didn't show up (hold is released)
const tripNoShowPayloadSchema = tripEventBaseSchema.extend({
  status: z.literal("no_show"),
  reason: z.string().meta({
    description: "No-show reason (typically 'Rider did not show up' from the driver)",
    example: "Rider did not show up"
  }),
});

registry.registerComponent("schemas", "TripNoShowEvent", tripNoShowPayloadSchema);

// ============================================================================
// Connection & Error Handling
// ============================================================================

/**
 * Connection flow:
 *
 * 1. Client connects:
 *    io(baseUrl, {
 *      auth: { token: accessToken },
 *      transports: ["websocket"],
 *      reconnection: true,
 *      reconnectionDelayMax: 5000,
 *    })
 *
 * 2. Server validates token:
 *    - Valid & current: Connection accepted, client joins room user:{userId}
 *    - Missing, invalid, or expired: connect_error fired with status 401/403
 *
 * 3. Events arrive in the client's room (user:{userId}):
 *    socket.on("trip:requested", (payload) => { ... })
 *
 * 4. Token expiry handling:
 *    - Access tokens expire after 15 minutes
 *    - For long-lived connections, exchange refresh token at POST /auth/refresh
 *    - Reconnect with the new access token before the old one expires
 *    - If token expires during connection, next REST API call returns 401
 *
 * Errors:
 *    socket.on("connect_error", (error) => {
 *      if (error.data?.status === 401) {
 *        // Token expired — refresh and reconnect
 *      }
 *    })
 */

// Summary schema listing all events for reference
const socketEventsReferenceSchema = z.object({
  "user:suspended": z.object({
    description: z.literal("Account suspended"),
    sentTo: z.literal("The suspended account"),
    payload: userSuspendedPayloadSchema,
  }),
  "driver:verification_status_changed": z.object({
    description: z.literal("Driver verification status changed (automatic or admin approval)"),
    sentTo: z.literal("The driver"),
    payload: driverVerificationStatusChangedPayloadSchema,
  }),
  "trip:requested": z.object({
    description: z.literal("Rider requested a seat on a commute"),
    sentTo: z.literal("The driver who owns the commute"),
    payload: tripRequestedPayloadSchema,
  }),
  "trip:cancelled": z.object({
    description: z.literal("Trip was cancelled"),
    sentTo: z.literal("The party that didn't cancel"),
    payload: tripCancelledPayloadSchema,
  }),
  "trip:accepted": z.object({
    description: z.literal("Driver accepted the rider's request"),
    sentTo: z.literal("The rider"),
    payload: tripAcceptedPayloadSchema,
  }),
  "trip:declined": z.object({
    description: z.literal("Driver declined the rider's request"),
    sentTo: z.literal("The rider"),
    payload: tripDeclinedPayloadSchema,
  }),
  "trip:driver_arrived": z.object({
    description: z.literal("Driver marked arrival at the pickup point"),
    sentTo: z.literal("The rider"),
    payload: tripDriverArrivedPayloadSchema,
  }),
  "trip:boarded": z.object({
    description: z.literal("Driver scanned the rider's boarding code (money is charged)"),
    sentTo: z.literal("The rider"),
    payload: tripBoardedPayloadSchema,
  }),
  "trip:completed": z.object({
    description: z.literal("Trip completed (driver is paid)"),
    sentTo: z.literal("The rider"),
    payload: tripCompletedPayloadSchema,
  }),
  "trip:no_show": z.object({
    description: z.literal("Driver reported the rider didn't show up"),
    sentTo: z.literal("The rider"),
    payload: tripNoShowPayloadSchema,
  }),
});

registry.registerComponent("schemas", "SocketEventsReference", socketEventsReferenceSchema);

// Note: This file registers socket event schemas for reference in Swagger UI.
// Socket.IO events are not REST endpoints, so they appear as components, not paths.
// See SOCKET_EVENTS.md for full documentation on connection, payloads, and error handling.
