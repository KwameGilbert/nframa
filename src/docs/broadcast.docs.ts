import { errorResponse, registry, successResponse } from "./registry.js";
import {
  audiencePreviewQuerySchema,
  audiencePreviewResponseSchema,
  smsBalanceResponseSchema,
  broadcastListResponseSchema,
  broadcastParamsSchema,
  broadcastResponseSchema,
  createBroadcastSchema,
  listBroadcastsQuerySchema,
  scheduleBroadcastSchema,
  updateBroadcastSchema,
} from "../schemas/broadcast.schema.js";

const TAG = "Broadcasts";
const NOT_FOUND_EXAMPLE = "Broadcast not found: 5b1f0c7e-2d3a-4c8e-9f61-7a2b3c4d5e6f";
const notFound = errorResponse("No such broadcast", NOT_FOUND_EXAMPLE);
const unauthorized = errorResponse("Missing or invalid access token");
const forbidden = (action: string) =>
  errorResponse(
    `Missing permission: ${action} on broadcasts`,
    `Missing permission: ${action} on broadcasts`,
  );
const smsTooLong = "The SMS would be 4 messages long; keep it to 3 or set a shorter smsText";

registry.registerPath({
  method: "get",
  path: "/admin/broadcasts",
  tags: [TAG],
  summary: "List broadcasts (needs broadcasts: read)",
  description:
    "The Broadcast Studio's history, newest first: drafts, scheduled ones and everything sent or cancelled. Filter by status, audience, a channel it uses, words in the title, or a creation date range (UTC days).",
  security: [{ bearerAuth: [] }],
  request: { query: listBroadcastsQuerySchema },
  responses: {
    200: successResponse("Broadcasts retrieved successfully", broadcastListResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: forbidden("read"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/broadcasts/audience-preview",
  tags: [TAG],
  summary: "Count who a broadcast would reach (needs broadcasts: read)",
  description:
    "Before sending: how many active riders/drivers are in the audience, and how many of them each channel reaches right now (in-app: all of them; push: those with a device that has opened the app recently; SMS: those with a phone number; email: those with an email address). Staff, suspended and deleted accounts are never included.",
  security: [{ bearerAuth: [] }],
  request: { query: audiencePreviewQuerySchema },
  responses: {
    200: successResponse("Audience counted successfully", audiencePreviewResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: forbidden("read"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/broadcasts/sms-balance",
  tags: [TAG],
  summary: "SMS units left (needs broadcasts: read)",
  description:
    "Asked of the SMS provider (Arkesel) on each call. Show it next to the audience preview: an SMS broadcast costs about reachable.sms × smsSegments units, and sign-in codes come out of the same units, so keep enough for them.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("SMS balance retrieved successfully", smsBalanceResponseSchema),
    401: unauthorized,
    403: forbidden("read"),
    502: errorResponse(
      "The SMS provider couldn't be reached or didn't report a balance",
      "Couldn't reach the SMS provider, try again",
    ),
    503: errorResponse("SMS isn't configured on the server", "SMS is not configured"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/broadcasts/{id}",
  tags: [TAG],
  summary: "Get a broadcast (needs broadcasts: read)",
  security: [{ bearerAuth: [] }],
  request: { params: broadcastParamsSchema },
  responses: {
    200: successResponse("Broadcast retrieved successfully", broadcastResponseSchema),
    400: errorResponse("Invalid broadcast id"),
    401: unauthorized,
    403: forbidden("read"),
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/broadcasts",
  tags: [TAG],
  summary: "Draft a broadcast (needs broadcasts: create)",
  description: `Always saved as a draft; set when it goes out with POST /admin/broadcasts/{id}/schedule. With sms as a channel, the SMS text (smsText, or "title: body" without it) must fit in 3 SMS, or it's refused with 400. smsSegments in the response says how many SMS it is.`,
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: createBroadcastSchema } } },
  },
  responses: {
    201: successResponse("Broadcast created successfully", broadcastResponseSchema),
    400: errorResponse("Validation error, or the SMS text is longer than 3 SMS", smsTooLong),
    401: unauthorized,
    403: forbidden("create"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/broadcasts/{id}",
  tags: [TAG],
  summary: "Edit a draft or scheduled broadcast (needs broadcasts: update)",
  description:
    "Changes only the fields sent; a scheduled broadcast keeps its time (move it with POST /admin/broadcasts/{id}/schedule). Once it is sending, sent, cancelled or failed it can't be edited (409).",
  security: [{ bearerAuth: [] }],
  request: {
    params: broadcastParamsSchema,
    body: { content: { "application/json": { schema: updateBroadcastSchema } } },
  },
  responses: {
    200: successResponse("Broadcast updated successfully", broadcastResponseSchema),
    400: errorResponse("Validation error, or the SMS text is longer than 3 SMS", smsTooLong),
    401: unauthorized,
    403: forbidden("update"),
    404: notFound,
    409: errorResponse(
      "The broadcast is sending, sent, cancelled or failed",
      "The broadcast is sent, so it can't be edited",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/broadcasts/{id}/schedule",
  tags: [TAG],
  summary: "Schedule or reschedule a broadcast (needs broadcasts: update)",
  description:
    "Sets when a draft goes out, or moves a scheduled one. The time must be at least a minute from now and at most 90 days ahead; it is sent within a minute of it. Cancel it with POST /admin/broadcasts/{id}/cancel.",
  security: [{ bearerAuth: [] }],
  request: {
    params: broadcastParamsSchema,
    body: { content: { "application/json": { schema: scheduleBroadcastSchema } } },
  },
  responses: {
    200: successResponse("Broadcast scheduled successfully", broadcastResponseSchema),
    400: errorResponse(
      "Validation error, or the time is less than a minute away or more than 90 days ahead",
      "scheduledFor must be at least a minute from now",
    ),
    401: unauthorized,
    403: forbidden("update"),
    404: notFound,
    409: errorResponse(
      "The broadcast is sending, sent, cancelled or failed",
      "The broadcast is sending, so it can't be scheduled",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/broadcasts/{id}/cancel",
  tags: [TAG],
  summary: "Cancel a scheduled broadcast (needs broadcasts: update)",
  description:
    "It won't go out and stays in the history as cancelled. Only a scheduled one can be cancelled: delete a draft instead, and one that has started sending can't be called back (409).",
  security: [{ bearerAuth: [] }],
  request: { params: broadcastParamsSchema },
  responses: {
    200: successResponse("Broadcast cancelled successfully", broadcastResponseSchema),
    400: errorResponse("Invalid broadcast id"),
    401: unauthorized,
    403: forbidden("update"),
    404: notFound,
    409: errorResponse(
      "The broadcast is a draft, or it is already sending, sent, cancelled or failed",
      "Only a scheduled broadcast can be cancelled; delete a draft instead",
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/broadcasts/{id}",
  tags: [TAG],
  summary: "Delete a draft broadcast (needs broadcasts: delete)",
  description:
    "Only drafts: anything scheduled or sent stays in the history (cancel a scheduled one instead).",
  security: [{ bearerAuth: [] }],
  request: { params: broadcastParamsSchema },
  responses: {
    200: successResponse("Broadcast deleted successfully"),
    400: errorResponse("Invalid broadcast id"),
    401: unauthorized,
    403: forbidden("delete"),
    404: notFound,
    409: errorResponse(
      "The broadcast isn't a draft",
      "The broadcast is scheduled, so it can't be deleted; only drafts can",
    ),
  },
});
