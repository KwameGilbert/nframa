import { errorResponse, successResponse, registry } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  activityLogListResponseSchema,
  activityLogResponseSchema,
  listActivityLogsQuerySchema,
} from "../schemas/activityLog.schema.js";

registry.registerPath({
  method: "get",
  path: "/admin/activity-logs",
  tags: ["Activity Logs"],
  summary: "List activity logs",
  description:
    "The audit trail: every create, update and delete that went through, and every sign-up, sign-in, sign-out, token refresh and password change, by any account (admin, rider or driver). Each entry records who did it, what they did and to which record, from which IP and device, and for changes the record before and after. Requests refused before anything changed (no permission, invalid input) aren't recorded; failed sign-ins and password resets are, as failures, against the account they targeted. Filter by any combination of the query parameters; `targetType` + `targetId` gives one record's full history (e.g. `targetType=setting&targetId=fares.baseFare`, or `targetType=user&targetId=<id>` for an account's sign-ins and changes). Newest first. Entries can't be edited or deleted. Needs activityLogs: read.",
  security: [{ bearerAuth: [] }],
  request: { query: listActivityLogsQuerySchema },
  responses: {
    200: successResponse("Activity logs retrieved successfully", activityLogListResponseSchema),
    400: errorResponse("Invalid filter (e.g. a malformed date, or from after to)"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on activityLogs"),
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/activity-logs/{id}",
  tags: ["Activity Logs"],
  summary: "Get an activity log entry",
  description: "One audit entry with everything recorded about it. Needs activityLogs: read.",
  security: [{ bearerAuth: [] }],
  request: { params: idParamsSchema },
  responses: {
    200: successResponse("Activity log retrieved successfully", activityLogResponseSchema),
    400: errorResponse("id is not a UUID"),
    401: errorResponse("Missing or invalid access token"),
    403: errorResponse("Missing permission: read on activityLogs"),
    404: errorResponse(
      "Activity log not found",
      "Activity log not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    ),
  },
});
