import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  listNotificationsQuerySchema,
  notificationDeleteResponseSchema,
  notificationListResponseSchema,
  notificationParamsSchema,
  notificationReadAllResponseSchema,
  notificationReadResponseSchema,
} from "../schemas/notification.schema.js";

const TAG = "Notifications";
const unauthorized = errorResponse("Missing or invalid access token");
const NOT_FOUND = errorResponse(
  "No such notification of the caller's (another account's, or already deleted)",
  "Notification not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
);
const BAD_ID = errorResponse("Invalid notification id", "id: Invalid UUID");
const RULES =
  "Only the caller's own inbox. Not recorded in the audit trail (housekeeping of one's own messages). Rate limited per account (300 per 15 minutes, shared by every inbox route).";

registry.registerPath({
  method: "get",
  path: "/notifications",
  tags: [TAG],
  summary: "List my notifications (any signed-in user)",
  description: `The caller's notification inbox, newest first, paginated (limit up to 50); filter by unread=true (only unread) or unread=false (only read), and by type. unreadCount counts the whole inbox, not just this page or filter, for the app badge. Rows are written alongside the push (trip, safety, account, wallet and review updates) and kept for 90 days (setting notifications.retentionDays). Some pushes have no row: the driver-arrived alert, which is only useful in the moment, and staff desk alerts; their types (trip.driverArrived, sos.deskAlert, report.deskUrgent) are refused as a type filter with 400. New rows arrive live as the socket event notification:new ({ notification, unreadCount }) to the user's room. For SOS and report updates the push shows only generic text; the specific text is here. ${RULES}`,
  security: [{ bearerAuth: [] }],
  request: { query: listNotificationsQuerySchema },
  responses: {
    200: successResponse("Notifications retrieved successfully", notificationListResponseSchema),
    400: errorResponse(
      "Validation error: page under 1, limit outside 1 to 50, unread other than true or false, or a type that is unknown or never kept in the inbox (push-only)",
      "limit: Too big: expected number to be <=50",
    ),
    401: unauthorized,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/notifications/read-all",
  tags: [TAG],
  summary: "Mark all my notifications read (any signed-in user)",
  description: `Marks every unread notification of the caller's read. updatedCount is how many it changed (0 when there were none); unreadCount is what is left (0 unless one arrived meanwhile), so reset the badge to it. ${RULES}`,
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("All notifications marked as read", notificationReadAllResponseSchema),
    401: unauthorized,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/notifications/{id}/read",
  tags: [TAG],
  summary: "Mark one of my notifications read (any signed-in user)",
  description: `Use it when a notification is opened: a push's data carries its notificationId. Idempotent: reading it again changes nothing and keeps the first readAt. 404 for an id that isn't the caller's, exactly as for one that doesn't exist. ${RULES}`,
  security: [{ bearerAuth: [] }],
  request: { params: notificationParamsSchema },
  responses: {
    200: successResponse("Notification marked as read", notificationReadResponseSchema),
    400: BAD_ID,
    401: unauthorized,
    404: NOT_FOUND,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "delete",
  path: "/notifications/{id}",
  tags: [TAG],
  summary: "Delete one of my notifications (any signed-in user)",
  description: `Removes it from the inbox for good. 404 for an id that isn't the caller's or was already deleted. ${RULES}`,
  security: [{ bearerAuth: [] }],
  request: { params: notificationParamsSchema },
  responses: {
    200: successResponse("Notification deleted successfully", notificationDeleteResponseSchema),
    400: BAD_ID,
    401: unauthorized,
    404: NOT_FOUND,
    429: rateLimitedResponse,
  },
});
