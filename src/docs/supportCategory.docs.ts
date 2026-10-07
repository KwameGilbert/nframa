import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  adminSupportCategoryResponseSchema,
  createSupportCategorySchema,
  supportCategoryResponseSchema,
  updateSupportCategorySchema,
} from "../schemas/supportCategory.schema.js";

const TAG = "Support";
const unauthorized = errorResponse("Missing or invalid access token");
const NOT_FOUND = errorResponse(
  "No such category",
  "Support category not found: 3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
);
const DUPLICATE = errorResponse(
  "Another category already has this name (ignoring case)",
  'A support category named "Lost item" already exists',
);

registry.registerPath({
  method: "get",
  path: "/support/categories",
  tags: [TAG],
  summary: "List the categories I can open a ticket under (any signed-in user)",
  description:
    "The active categories meant for everyone or for the caller's role (riders don't see driver-only ones such as payouts), ordered as staff arranged them. Pick one when opening a ticket. Staff calling it get every active category. Rate limited per account (300 per 15 minutes, shared by every support read).",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Support categories retrieved successfully",
      supportCategoryResponseSchema.array(),
    ),
    401: unauthorized,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/admin/support/categories",
  tags: [TAG],
  summary: "List every support category (needs support: read)",
  description:
    "Active and inactive categories, ordered by sortOrder then name, each with its audience, default priority and ticketCount (tickets filed under it, any status). Not paginated. Needs support: read.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse(
      "Support categories retrieved successfully",
      adminSupportCategoryResponseSchema.array(),
    ),
    401: unauthorized,
    403: errorResponse("Missing permission: read on support"),
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/support/categories",
  tags: [TAG],
  summary: "Create a support category (needs support: create)",
  description:
    "name (2 to 60 characters) must be unique ignoring case. audience limits who can pick it (all, rider or driver; default all), defaultPriority is the priority new tickets in it start with (default normal), and sortOrder places it in the list (lower first, default 0). Recorded in the audit trail (supportCategory.create). Needs support: create.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: createSupportCategorySchema } } },
  },
  responses: {
    201: successResponse(
      "Support category created successfully",
      adminSupportCategoryResponseSchema,
    ),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Missing permission: create on support"),
    409: DUPLICATE,
  },
});

registry.registerPath({
  method: "patch",
  path: "/admin/support/categories/{id}",
  tags: [TAG],
  summary: "Update a support category (needs support: update)",
  description:
    "Send only the fields to change (at least one). Set isActive to false to stop users picking it: its existing tickets keep it. Changing defaultPriority doesn't touch existing tickets. The before and after are recorded in the audit trail (supportCategory.update). Needs support: update.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamsSchema,
    body: { content: { "application/json": { schema: updateSupportCategorySchema } } },
  },
  responses: {
    200: successResponse(
      "Support category updated successfully",
      adminSupportCategoryResponseSchema,
    ),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Missing permission: update on support"),
    404: NOT_FOUND,
    409: DUPLICATE,
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/support/categories/{id}",
  tags: [TAG],
  summary: "Delete an unused support category (needs support: delete)",
  description:
    "Only a category no ticket was ever filed under can be deleted; deactivate a used one instead (PATCH with isActive false). Recorded in the audit trail (supportCategory.delete). Needs support: delete.",
  security: [{ bearerAuth: [] }],
  request: { params: idParamsSchema },
  responses: {
    200: successResponse("Support category deleted successfully"),
    400: errorResponse("Validation error"),
    401: unauthorized,
    403: errorResponse("Missing permission: delete on support"),
    404: NOT_FOUND,
    409: errorResponse(
      "Tickets were filed under this category",
      "This category is used by 3 tickets; deactivate it instead",
    ),
  },
});
