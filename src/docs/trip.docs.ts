import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  availableTripListSchema,
  availableTripsQuerySchema,
  cancelTripSchema,
  commuteManifestSchema,
  commuteTripsQuerySchema,
  createTripSchema,
  declineTripSchema,
  listTripsQuerySchema,
  tripDetailSchema,
  tripListSchema,
} from "../schemas/trip.schema.js";

const unauthorized = errorResponse("Missing or invalid access token");
const TRIP_ID = "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60";
const tripNotFound = errorResponse("No trip has this id", `Trip not found: ${TRIP_ID}`);
const COMMUTE_ID = "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34";

registry.registerPath({
  method: "get",
  path: "/trips/available",
  tags: ["Trips"],
  summary: "Find commutes to ride on a date (riders)",
  description:
    "Commutes whose start is within the trips.availabilityRadiusKm setting of the rider's location, on a date from today up to trips.bookingWindowDays ahead: active, running that weekday, with an approved and active driver, not yet departed (for today), and with a seat left. Nearest start first, then earliest departure. No fare per item: ask POST /fares/estimate with the pickup and drop-off.",
  security: [{ bearerAuth: [] }],
  request: { query: availableTripsQuerySchema },
  responses: {
    200: successResponse("Available trips retrieved successfully", availableTripListSchema),
    400: errorResponse(
      "Invalid query, or a date in the past or beyond the booking window",
      "The date can't be in the past",
    ),
    401: unauthorized,
    403: errorResponse("The caller isn't a rider", "Only riders can browse trips"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips",
  tags: ["Trips"],
  summary: "Request a seat on a commute (riders)",
  description: [
    "Checks, in order: the caller is a rider with a rider profile; the commute exists, is active and its driver approved; it isn't the caller's own; it runs on tripDate's weekday and tripDate is within the booking window; pickup and drop-off are each within trips.routeToleranceKm of the commute's start-to-end line, with pickup before drop-off in the direction of travel; the scheduled pickup (departure plus the share of the commute's driving time up to the pickup) is still ahead; the rider's available balance covers the total; and the rider has no other trip overlapping in time.",
    "",
    "The price is worked out from the driving route between pickup and drop-off (fare plus platform and booking fees; the driver earns the fare). If the driver accepts bookings automatically, the trip is accepted at once: a seat is taken and the total is held in the rider's wallet (not yet charged). Otherwise it is pending: no seat, no hold, and it expires after trips.requestExpiryMinutes (or at the pickup time, if sooner) unless the driver answers. The driver gets the trip:requested socket event either way.",
    "",
    'The response message says which happened: "Trip booked successfully" (accepted automatically) or "Trip requested successfully" (pending).',
  ].join("\n"),
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: createTripSchema } } } },
  responses: {
    201: successResponse("Trip requested successfully", tripDetailSchema),
    400: errorResponse(
      "Invalid body, no rider profile, own commute, wrong weekday, outside the booking window, off the route, wrong direction, or the pickup time has passed",
      "Pickup is more than 1 km from the commute's route",
    ),
    401: unauthorized,
    403: errorResponse("The caller isn't a rider", "Only riders can request trips"),
    404: errorResponse("No commute has this id", `Commute not found: ${COMMUTE_ID}`),
    409: errorResponse(
      "The commute is paused or its driver not approved; not enough available balance; an overlapping trip; already a trip on this commute that date; or no seat left",
      "Insufficient wallet balance",
    ),
    429: rateLimitedResponse,
    503: errorResponse(
      "Every fare and fee setting is zero, so there is nothing to charge",
      "Fares are not configured",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/trips",
  tags: ["Trips"],
  summary: "List my trips (riders: their own; drivers: trips on their commutes)",
  description:
    "upcoming: pending, accepted or boarded and not over yet (boarded, or the drop-off still ahead), soonest first. past: everything else, newest first. Pending requests past their expiry show as expired.",
  security: [{ bearerAuth: [] }],
  request: { query: listTripsQuerySchema },
  responses: {
    200: successResponse("Trips retrieved successfully", tripListSchema),
    400: errorResponse("Invalid when, status, page or limit"),
    401: unauthorized,
    403: errorResponse("The caller is an admin", "Only riders and drivers have trips"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}",
  tags: ["Trips"],
  summary: "Get a trip (its rider, its driver, or an admin with trips: read)",
  description:
    "The trip with its commute, driver, rider, vehicle, seats left on that date, the other riders with a confirmed seat (first name and photo only) and every confirmed rider's pickup and drop-off as stops in route order. Until the rider's own trip is accepted, the rider sees no other riders and only their own two stops. The boarding code is shown to the rider only. Once the trip is accepted, the driver's phone is shown to the rider, the rider's phone to the driver, and the vehicle's plate to both.",
  security: [{ bearerAuth: [] }],
  request: { params: idParamsSchema },
  responses: {
    200: successResponse("Trip retrieved successfully", tripDetailSchema),
    400: errorResponse("Invalid trip id"),
    401: unauthorized,
    403: errorResponse("Not the trip's rider or driver, and lacking trips: read"),
    404: tripNotFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/cancel",
  tags: ["Trips"],
  summary: "Cancel a trip (its rider before boarding, or its driver once accepted)",
  description:
    "The rider can cancel a pending or accepted trip; the driver an accepted one. Cancelling an accepted trip frees its seat and releases the held money back to the rider's available balance (nothing is charged). The other party gets the trip:cancelled socket event.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
    body: { content: { "application/json": { schema: cancelTripSchema } } },
  },
  responses: {
    200: successResponse("Trip cancelled successfully", tripDetailSchema),
    400: errorResponse("Invalid trip id or reason"),
    401: unauthorized,
    403: errorResponse(
      "Not the trip's rider or driver",
      "Only the trip's rider or driver can cancel it",
    ),
    404: tripNotFound,
    409: errorResponse(
      "The trip can't be cancelled in its status (boarded, already cancelled, ...; a driver can't cancel a pending request)",
      "Can't cancel a trip that is boarded",
    ),
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/accept",
  tags: ["Trips"],
  summary: "Accept a pending trip request (the trip's driver)",
  description:
    "In one transaction: locks the commute (so simultaneous accepts on it run one at a time and can never hand out the same seat), re-checks that the commute is active, its driver still approved, active and not deleted, the request still pending and unexpired, and a seat left, then holds the trip's total in the rider's wallet and marks it accepted. If the rider's available balance no longer covers the total, nothing is held and the trip stays pending. A request past its expiry is marked expired and refused. Returns the trip as the driver sees it: never the boarding code, but the rider's phone now that it's accepted. The rider gets the trip:accepted socket event.",
  security: [{ bearerAuth: [] }],
  request: { params: idParamsSchema },
  responses: {
    200: successResponse("Trip accepted successfully", tripDetailSchema),
    400: errorResponse("Invalid trip id"),
    401: unauthorized,
    403: errorResponse(
      "Not the trip's driver (riders and admins included)",
      "Only the trip's driver can accept it",
    ),
    404: tripNotFound,
    409: errorResponse(
      'Not pending (already accepted, declined, cancelled, expired, ...); the commute is paused or its driver is no longer approved, active or undeleted ("This commute is not taking bookings"); the commute is full on that date ("This commute is full"); or the rider\'s available balance no longer covers the total ("The rider\'s wallet no longer covers this trip")',
      "Can't accept a trip that is expired",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/decline",
  tags: ["Trips"],
  summary: "Decline a pending trip request (the trip's driver)",
  description:
    "Only a pending request can be declined; an accepted trip is cancelled with POST /trips/{id}/cancel instead. A pending request holds no money and takes no seat, so nothing moves. The reason (optional) is stored as cancellationReason, with cancelledBy driver. The rider gets the trip:declined socket event.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
    body: { content: { "application/json": { schema: declineTripSchema } } },
  },
  responses: {
    200: successResponse("Trip declined successfully", tripDetailSchema),
    400: errorResponse("Invalid trip id or reason"),
    401: unauthorized,
    403: errorResponse(
      "Not the trip's driver (riders and admins included)",
      "Only the trip's driver can decline it",
    ),
    404: tripNotFound,
    409: errorResponse(
      "The trip isn't pending (accepted trips are cancelled instead)",
      "Can't decline a trip that is accepted",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/commutes/{id}/trips",
  tags: ["Trips"],
  summary: "A commute's trips on a date: the driver's manifest (its driver, or commutes: read)",
  description:
    "Every trip on one date's run of the commute (today by default; any date), soonest pickup first, optionally filtered by status and paginated. Each item has the rider's id, full name and photo; the rider's phone only for the commute's driver (never an admin), once the trip is accepted (or boarded, completed). Never a boarding code. Alongside: the commute's capacity, the seats left on that date, and stops, the route sheet of every accepted and boarded rider's pickup and drop-off in route order with their first name (not paginated or filtered). Pending requests past their expiry show as expired.",
  security: [{ bearerAuth: [] }],
  request: { params: idParamsSchema, query: commuteTripsQuerySchema },
  responses: {
    200: successResponse("Commute trips retrieved successfully", commuteManifestSchema),
    400: errorResponse("Invalid commute id, date, status, page or limit"),
    401: unauthorized,
    403: errorResponse(
      "Not the commute's driver and lacking commutes: read",
      "Missing permission: read on commutes",
    ),
    404: errorResponse("No commute has this id", `Commute not found: ${COMMUTE_ID}`),
    429: rateLimitedResponse,
  },
});
