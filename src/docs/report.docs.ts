import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  adminListReportsQuerySchema,
  createReportMultipartSchema,
  createReportSchema,
  listMyReportsQuerySchema,
  reportAdminDetailResponseSchema,
  reportAdminListResponseSchema,
  reportAdminResponseSchema,
  reportListResponseSchema,
  reportParamsSchema,
  reportResponseSchema,
  tripReportsParamsSchema,
  updateReportStatusSchema,
} from "../schemas/report.schema.js";

const TAG = "Reports";
const NOT_FOUND_EXAMPLE = "Report not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34";
const NOT_FOUND = errorResponse("No such report of yours", NOT_FOUND_EXAMPLE);

registry.registerPath({
  method: "post",
  path: "/trips/{tripId}/reports",
  tags: [TAG],
  summary: "Report the other person on a trip",
  description:
    "A rider reports their driver, or a driver reports their rider, for misconduct or a safety problem on a trip: harassment, threats or assault, unsafe driving, suspected intoxication, discrimination, a car or driver that doesn't match the app, damage, a fare dispute, lateness. The person reported is worked out from the trip and is never told. Allowed from the moment the trip is accepted (while the rider waits, and during the ride) until 72 hours after it ends (an admin-editable setting, reports.filingWindowHours): after completion, after a cancellation that came after acceptance, or after a no-show. A request nobody accepted (pending, declined, expired) can't be reported. The category decides the severity: physicalAssault, threatOrIntimidation, sexualMisconduct, unsafeDriving and suspectedIntoxication are urgent and go to the top of staff's queue; the confirmation email then also tells the reporter to call 112 or use SOS if they are in danger right now. For an emergency in progress use POST /safety/sos; a report is the record, not the alarm. Send JSON for a written report, or multipart/form-data to attach up to 5 images (JPEG, PNG or WEBP, 5MB each) under the repeated 'evidence' field, in the same request; images can't be added later, and JSON can't carry them (its size limit is far too small for photos). Only staff ever see the description and the images. You can have one open report per trip and category; file again only after the last one is closed. Staff are alerted live (socket event report:created to admins with reports: read). Rate limited per account (20 per 15 minutes).",
  security: [{ bearerAuth: [] }],
  request: {
    params: tripReportsParamsSchema,
    body: {
      content: {
        "application/json": { schema: createReportSchema },
        "multipart/form-data": { schema: createReportMultipartSchema },
      },
    },
  },
  responses: {
    201: successResponse("Report filed successfully", reportResponseSchema),
    400: errorResponse(
      "Validation error (an unknown category, or a description under 10 or over 2000 characters), a file that isn't a JPEG/PNG/WEBP image, an image over 5MB, or more than 5 images",
      "You can attach up to 5 images, under the 'evidence' field",
    ),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse(
      "Not the trip's rider or driver (admins included)",
      "Only the trip's rider or driver can report it",
    ),
    404: errorResponse("Trip not found", "Trip not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34"),
    409: errorResponse(
      "The trip was never accepted (pending, declined, expired, or cancelled before acceptance), the filing window after it ended has passed, or an open report in that category already exists",
      "Can't report a trip that is pending",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/reports",
  tags: [TAG],
  summary: "List the reports I filed",
  description:
    "Only reports the caller filed, newest first, paginated; filter by status or trip. Each shows what the reporter wrote, the images they attached, where it stands and, once staff close it, the message staff wrote for them. Staff's private notes, which admin handled it and who was reported are never included. A person can't see reports filed about them: those endpoints answer 404.",
  security: [{ bearerAuth: [] }],
  request: { query: listMyReportsQuerySchema },
  responses: {
    200: successResponse("Reports retrieved successfully", reportListResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
  },
});

registry.registerPath({
  method: "get",
  path: "/reports/{id}",
  tags: [TAG],
  summary: "Get one of my reports",
  description:
    "Restores a report's status screen: where it stands (open, underReview, resolved, dismissed or withdrawn), the trip status when it was filed, and staff's message once it is closed. Follow changes live with the report:statusChanged socket event. 404 for a report that isn't the caller's, including one filed about the caller by someone else.",
  security: [{ bearerAuth: [] }],
  request: { params: reportParamsSchema },
  responses: {
    200: successResponse("Report retrieved successfully", reportResponseSchema),
    400: errorResponse("Invalid report id"),
    401: errorResponse("Missing or invalid access token"),
    404: NOT_FOUND,
  },
});

registry.registerPath({
  method: "post",
  path: "/reports/{id}/withdraw",
  tags: [TAG],
  summary: "Withdraw my report",
  description:
    "Takes a report back while staff haven't closed it (open or underReview). Withdrawing is final: to raise the issue again, file a new report. The desk is told (report:statusChanged). If staff close the report at the same moment, exactly one of the two wins and the other gets 409.",
  security: [{ bearerAuth: [] }],
  request: { params: reportParamsSchema },
  responses: {
    200: successResponse("Report withdrawn successfully", reportResponseSchema),
    400: errorResponse("Invalid report id"),
    401: errorResponse("Missing or invalid access token"),
    404: NOT_FOUND,
    409: errorResponse(
      "Staff already closed it, or it was withdrawn before",
      "Can't withdraw a report that is resolved",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/reports",
  tags: [TAG],
  summary: "List trip reports (needs reports: read)",
  description:
    "The staff queue. Unresolved reports (open, underReview) come first, urgent safety reports before the rest, newest first within each group; closed ones follow. Filter by status, severity, category, trip, the person who filed it, the person it is about, or a filing date range (UTC days). Each item has both people's names; open one for phones, the trip and their history. Opening the list is recorded in the audit trail. Listen for report:created and report:statusChanged on the live reports desk.",
  security: [{ bearerAuth: [] }],
  request: { query: adminListReportsQuerySchema },
  responses: {
    200: successResponse("Reports retrieved successfully", reportAdminListResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on reports"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/reports/{id}",
  tags: [TAG],
  summary: "Get a trip report with its context (needs reports: read)",
  description:
    "Everything staff need to decide: what was reported and the images, both people's names and phone numbers, the trip (route, date, status and when it was boarded, completed or cancelled), staff's notes, and a history block showing how many reports the reporter has filed and how many have been filed against the reported person (and how many of those are still unresolved) so repeat problems stand out. Each view is recorded in the audit trail because it holds personal accounts and phone numbers. Act on it with PATCH /admin/reports/{id}; suspending someone is the existing PATCH /users/{id}/status.",
  security: [{ bearerAuth: [] }],
  request: { params: reportParamsSchema },
  responses: {
    200: successResponse("Report retrieved successfully", reportAdminDetailResponseSchema),
    400: errorResponse("Invalid report id"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on reports"),
    404: errorResponse("Report not found", NOT_FOUND_EXAMPLE),
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/reports/{id}",
  tags: [TAG],
  summary: "Move a trip report along (needs reports: update)",
  description:
    "Staff pick a report up (underReview) and close it (resolved or dismissed), from open or underReview; closed reports can't change, and the reporter can still withdraw one that is open or under review. Moving it records which admin did, and closing it records when. internalNotes are staff-only; outcomeMessage is what the reporter is told, shown in the app and emailed when the report is resolved or dismissed. Both replace earlier text only when given. The reporter is told live (socket event report:statusChanged to their user room) and by email; the person reported is never told. To act on the person, use the existing user status route. If two staff act at the same moment, or the reporter withdraws, exactly one wins and the other gets 409.",
  security: [{ bearerAuth: [] }],
  request: {
    params: reportParamsSchema,
    body: { content: { "application/json": { schema: updateReportStatusSchema } } },
  },
  responses: {
    200: successResponse("Report updated successfully", reportAdminResponseSchema),
    400: errorResponse("Validation error, such as an unknown status or notes over 2000 characters"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: update on reports"),
    404: errorResponse("Report not found", NOT_FOUND_EXAMPLE),
    409: errorResponse(
      "The report is already resolved, dismissed or withdrawn",
      "Can't move a report from resolved to underReview",
    ),
  },
});
