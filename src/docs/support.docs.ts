import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  adminCreateTicketMultipartSchema,
  adminCreateTicketSchema,
  adminListTicketsQuerySchema,
  assigneeResponseSchema,
  assignTicketSchema,
  staffTicketDetailResponseSchema,
  staffTicketListResponseSchema,
  staffTicketResponseSchema,
  updateTicketSchema,
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

// Staff.

const STAFF_NOT_FOUND = errorResponse(
  "No such ticket",
  "Support ticket not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
);
const CLOSED = errorResponse("The ticket is closed", "This ticket is closed");
const LIVE =
  "Staff with support: read and the raiser's devices are told live (support:ticketUpdated); the raiser only gets public changes, never notes, assignment or who did it.";

registry.registerPath({
  method: "get",
  path: "/admin/support/tickets",
  tags: [TAG],
  summary: "The support queue (needs support: read)",
  description:
    "Every ticket, including those of deleted accounts and recycled phone numbers (detachedAt). Filters combine with AND; status, priority, categoryId and rating can be repeated for several values. assignedTo takes me, unassigned or an admin's id; needsReply=true keeps tickets whose last message is the user's. The default sort, queue, puts active tickets first, then the most urgent, then the longest waiting. Each item carries unreadCount (user messages no agent has read) and lastMessage (notes included). stats counts the whole queue regardless of filters (per status, unassigned, mine, needsReply) for tabs. Before answering, idle and expired tickets are resolved or closed. Needs support: read.",
  security: [{ bearerAuth: [] }],
  request: { query: adminListTicketsQuerySchema },
  responses: {
    200: successResponse("Support tickets retrieved successfully", staffTicketListResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Missing permission: read on support"),
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/support/tickets",
  tags: [TAG],
  summary: "Open a ticket on a user's behalf (needs support: create)",
  description:
    "For a rider or driver who reached support another way (a call, an email). The ticket starts in progress and assigned to you, with your message first; it appears in their app and they are told live (support:ticketCreated). The category must be one they could pick, and linked records must be theirs. priority defaults to the category's. Files as in POST /support/tickets (multipart, attachments field). Recorded in the audit trail (support.ticket.createOnBehalf). Needs support: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: adminCreateTicketSchema },
        "multipart/form-data": { schema: adminCreateTicketMultipartSchema },
      },
    },
  },
  responses: {
    201: successResponse("Support ticket created successfully", staffTicketResponseSchema),
    400: errorResponse(
      "Validation error, no message or file, an unavailable category, or the user isn't a rider or driver",
      "Support tickets can only be opened for riders and drivers",
    ),
    401: unauthorized,
    403: errorResponse("Missing permission: create on support"),
    404: errorResponse(
      "No such user, or a linked record isn't theirs",
      "User not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/support/assignees",
  tags: [TAG],
  summary: "Agents a ticket can be assigned to (needs support: read)",
  description:
    "Active admins whose role can update support, by name, with their department and how many active tickets they have. Needs support: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Support agents retrieved successfully", assigneeResponseSchema.array()),
    401: unauthorized,
    403: errorResponse("Missing permission: read on support"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/support/tickets/{id}",
  tags: [TAG],
  summary: "A ticket's full detail (needs support: read)",
  description:
    "The ticket with the raiser's contact details and account status, the linked trip, transaction or payout, the related ticket, and how many tickets this person has raised. Because it shows contact details, each view is recorded in the audit trail (support.ticket.view). Needs support: read.",
  security: [{ bearerAuth: [] }],
  request: { params: ticketParamsSchema },
  responses: {
    200: successResponse("Support ticket retrieved successfully", staffTicketDetailResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Missing permission: read on support"),
    404: STAFF_NOT_FOUND,
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/support/tickets/{id}",
  tags: [TAG],
  summary: "Change a ticket's status, priority, category or subject (needs support: update)",
  description: `Send at least one field. Moving to resolved starts the reopen window; moving a resolved ticket back to an active status clears its resolution and rating; closed is final (a later status change is 409, though the priority, category and subject can still be corrected). A status change is a public timeline event; priority, category and subject changes are one internal event. ${LIVE} Recorded in the audit trail (support.ticket.update). Needs support: update.`,
  security: [{ bearerAuth: [] }],
  request: {
    params: ticketParamsSchema,
    body: { content: { "application/json": { schema: updateTicketSchema } } },
  },
  responses: {
    200: successResponse("Support ticket updated successfully", staffTicketResponseSchema),
    400: errorResponse("Validation error, or an inactive category", "That support category isn't available"),
    401: unauthorized,
    403: errorResponse("Missing permission: update on support"),
    404: STAFF_NOT_FOUND,
    409: CLOSED,
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/support/tickets/{id}/assign",
  tags: [TAG],
  summary: "Take a ticket, give it to an agent, or take it over (needs support: update)",
  description: `With no body (or no adminId), assigns it to you; with adminId, to that agent, who must be an active admin whose role can update support (else 400). Works on a ticket someone else has (taking it over). An open ticket moves to in progress. Assigning it to whoever already has it changes nothing. Writes an internal assigned event naming the new and previous agent. ${LIVE} Recorded in the audit trail (support.ticket.assign). Needs support: update.`,
  security: [{ bearerAuth: [] }],
  request: {
    params: ticketParamsSchema,
    body: { required: false, content: { "application/json": { schema: assignTicketSchema } } },
  },
  responses: {
    200: successResponse("Support ticket assigned successfully", staffTicketResponseSchema),
    400: errorResponse("Validation error, or the agent can't take tickets", "That admin can't take support tickets"),
    401: unauthorized,
    403: errorResponse("Missing permission: update on support"),
    404: STAFF_NOT_FOUND,
    409: CLOSED,
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/support/tickets/{id}/unassign",
  tags: [TAG],
  summary: "Put a ticket back in the queue (needs support: update)",
  description: `Removes whoever has it; an in-progress ticket goes back to open. Already unassigned changes nothing. Writes an internal unassigned event. ${LIVE} Recorded in the audit trail (support.ticket.unassign). Needs support: update.`,
  security: [{ bearerAuth: [] }],
  request: { params: ticketParamsSchema },
  responses: {
    200: successResponse("Support ticket unassigned successfully", staffTicketResponseSchema),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Missing permission: update on support"),
    404: STAFF_NOT_FOUND,
    409: CLOSED,
  },
});
