import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  createTicketMultipartSchema,
  createTicketSchema,
  listMyTicketsQuerySchema,
  rateTicketSchema,
  ticketParamsSchema,
  userTicketDetailResponseSchema,
  userTicketListResponseSchema,
  userTicketResponseSchema,
} from "../schemas/support.schema.js";

const TAG = "Support";
const unauthorized = errorResponse("Missing or invalid access token");
const ONLY_USERS = errorResponse(
  "Staff can't open or act on tickets as a user",
  "Only riders and drivers can use support tickets",
);
const NOT_FOUND = errorResponse(
  "No such ticket of yours",
  "Support ticket not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
);
const OWN_ONLY =
  "Only the person who opened a ticket can see or act on it; anyone else gets 404.";
const SWEEP =
  "Before answering, a ticket that has waited on your reply for support.autoResolveDays (default 5) is resolved, and one resolved more than support.reopenWindowDays (default 7) ago is closed.";

registry.registerPath({
  method: "post",
  path: "/support/tickets",
  tags: [TAG],
  summary: "Open a support ticket (riders and drivers)",
  description: `Pick a category from GET /support/categories, write a short subject and a first message, and optionally link the trip, wallet transaction, payout or earlier ticket it's about (each must be yours, else 404). Send JSON for text only, or multipart/form-data to attach up to 5 files under the repeated attachments field: images (JPEG, PNG, WEBP, HEIC; 10MB), videos (MP4, MOV, WEBM, 3GP; 50MB), audio such as voice notes (M4A, AAC, MP3, OGG, WEBM, WAV; 16MB) and documents (PDF, Word, Excel, TXT, CSV; 10MB). A message or at least one file is required. The priority comes from the category (staff can change it; you never see it). The ticket gets a code such as ST-7KQ2MX to quote. Staff are alerted live (support:ticketCreated to admins with support: read). The subject and messages never appear in logs or the audit trail. Rate limited per account (10 per 15 minutes).`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createTicketSchema },
        "multipart/form-data": { schema: createTicketMultipartSchema },
      },
    },
  },
  responses: {
    201: successResponse("Support ticket created successfully", userTicketResponseSchema),
    400: errorResponse(
      "Validation error, no message or file, an unavailable category, or a file that's too big, of an unsupported type or one too many",
      "Write a message or attach a file",
    ),
    401: unauthorized,
    403: ONLY_USERS,
    404: errorResponse(
      "A linked trip, transaction, payout or ticket isn't yours",
      "Trip not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/support/tickets",
  tags: [TAG],
  summary: "List my support tickets (riders and drivers)",
  description: `Newest activity first. Each ticket carries unreadCount (support messages you haven't read) and lastMessage (a 120-character preview, or the kind of file sent) for the inbox screen. Filter by status (repeat the parameter for several, e.g. ?status=open&status=inProgress) or by trip. ${SWEEP} Rate limited per account (300 per 15 minutes, shared by every support read).`,
  security: [{ bearerAuth: [] }],
  request: { query: listMyTicketsQuerySchema },
  responses: {
    200: successResponse("Support tickets retrieved successfully", userTicketListResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: ONLY_USERS,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/support/tickets/{id}",
  tags: [TAG],
  summary: "Get one of my support tickets (riders and drivers)",
  description: `The ticket with canReply (false once it's closed) and reopenUntil (for a resolved ticket: a reply before then reopens it). ${OWN_ONLY} ${SWEEP} Rate limited per account (300 per 15 minutes, shared by every support read).`,
  security: [{ bearerAuth: [] }],
  request: { params: ticketParamsSchema },
  responses: {
    200: successResponse("Support ticket retrieved successfully", userTicketDetailResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: ONLY_USERS,
    404: NOT_FOUND,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/support/tickets/{id}/resolve",
  tags: [TAG],
  summary: "Mark my ticket as resolved (riders and drivers)",
  description: `For when your problem is sorted. Only an open, in-progress or awaiting ticket can be resolved. You can still reply within the reopen window, which reopens it, and you can rate the help. Staff and your other devices are told live (support:ticketUpdated). Recorded in the audit trail (support.ticket.resolve). ${OWN_ONLY} Rate limited per account (120 per 15 minutes, shared with messages).`,
  security: [{ bearerAuth: [] }],
  request: { params: ticketParamsSchema },
  responses: {
    200: successResponse("Support ticket resolved successfully", userTicketResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: ONLY_USERS,
    404: NOT_FOUND,
    409: errorResponse("Already resolved or closed", "This ticket is already resolved"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/support/tickets/{id}/rate",
  tags: [TAG],
  summary: "Rate the help on my resolved ticket (riders and drivers)",
  description: `Once per resolution: a 1 to 5 rating and an optional comment, on a resolved or closed ticket. If the ticket is reopened, the rating is cleared so the next resolution can be rated. Staff are told live (support:ticketUpdated). Recorded in the audit trail (support.ticket.rate) without the comment. ${OWN_ONLY} Rate limited per account (120 per 15 minutes, shared with messages).`,
  security: [{ bearerAuth: [] }],
  request: {
    params: ticketParamsSchema,
    body: { content: { "application/json": { schema: rateTicketSchema } } },
  },
  responses: {
    200: successResponse("Support ticket rated successfully", userTicketResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: ONLY_USERS,
    404: NOT_FOUND,
    409: errorResponse(
      "Not resolved yet, or already rated",
      "You have already rated this ticket",
    ),
    429: rateLimitedResponse,
  },
});
