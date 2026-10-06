import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  supportBrowseLimit,
  supportMessageLimit,
  supportTicketLimit,
} from "../middlewares/rateLimit.js";
import { uploadAttachments } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import {
  createTicket,
  getMyTicket,
  listMyTickets,
  deleteMyMessage,
  listMyMessages,
  postMyMessage,
  rateMyTicket,
  readMyTicket,
  resolveMyTicket,
} from "../controllers/support.controller.js";
import {
  adminDeleteMessage,
  adminListMessages,
  adminPostMessage,
  adminPostNote,
  adminReadTicket,
  adminCreateTicket,
  adminGetTicket,
  adminListTickets,
  adminUpdateTicket,
  assignTicket,
  listAssignees,
  unassignTicket,
} from "../controllers/supportAdmin.controller.js";
import {
  adminCreateTicketSchema,
  adminListTicketsQuerySchema,
  assignTicketSchema,
  updateTicketSchema,
  createTicketSchema,
  listMessagesQuerySchema,
  listMyTicketsQuerySchema,
  messageParamsSchema,
  postMessageSchema,
  rateTicketSchema,
  ticketParamsSchema,
} from "../schemas/support.schema.js";
import {
  adminListSupportCategories,
  createSupportCategory,
  deleteSupportCategory,
  listSupportCategories,
  updateSupportCategory,
} from "../controllers/supportCategory.controller.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createSupportCategorySchema,
  updateSupportCategorySchema,
} from "../schemas/supportCategory.schema.js";

export const supportRouter = Router();

// Riders and drivers. A ticket is only ever seen by the person who raised it (anyone else gets 404). Files are
// parsed by uploadAttachments before validate(), since express.json() skips multipart bodies; the limiter runs
// first so a refused request never uploads anything.
supportRouter.get("/support/categories", authenticate, supportBrowseLimit, listSupportCategories);

supportRouter.post(
  "/support/tickets",
  authenticate,
  supportTicketLimit,
  uploadAttachments(),
  validate({ body: createTicketSchema }),
  createTicket,
);

supportRouter.get(
  "/support/tickets",
  authenticate,
  supportBrowseLimit,
  validate({ query: listMyTicketsQuerySchema }),
  listMyTickets,
);

supportRouter.get(
  "/support/tickets/:id",
  authenticate,
  supportBrowseLimit,
  validate({ params: ticketParamsSchema }),
  getMyTicket,
);

supportRouter.post(
  "/support/tickets/:id/resolve",
  authenticate,
  supportMessageLimit,
  validate({ params: ticketParamsSchema }),
  resolveMyTicket,
);

supportRouter.post(
  "/support/tickets/:id/rate",
  authenticate,
  supportMessageLimit,
  validate({ params: ticketParamsSchema, body: rateTicketSchema }),
  rateMyTicket,
);

supportRouter.get(
  "/support/tickets/:id/messages",
  authenticate,
  supportBrowseLimit,
  validate({ params: ticketParamsSchema, query: listMessagesQuerySchema }),
  listMyMessages,
);

supportRouter.post(
  "/support/tickets/:id/messages",
  authenticate,
  supportMessageLimit,
  uploadAttachments(),
  validate({ params: ticketParamsSchema, body: postMessageSchema }),
  postMyMessage,
);

supportRouter.delete(
  "/support/tickets/:id/messages/:messageId",
  authenticate,
  supportMessageLimit,
  validate({ params: messageParamsSchema }),
  deleteMyMessage,
);

supportRouter.post(
  "/support/tickets/:id/read",
  authenticate,
  supportBrowseLimit,
  validate({ params: ticketParamsSchema }),
  readMyTicket,
);

// Staff. No limiter, like the other admin desks.
supportRouter.get(
  "/admin/support/tickets/:id/messages",
  authenticate,
  requirePermission("support", "read"),
  validate({ params: ticketParamsSchema, query: listMessagesQuerySchema }),
  adminListMessages,
);

for (const [path, handler] of [
  ["messages", adminPostMessage],
  ["notes", adminPostNote],
] as const) {
  supportRouter.post(
    `/admin/support/tickets/:id/${path}`,
    authenticate,
    requirePermission("support", "update"),
    uploadAttachments(),
    validate({ params: ticketParamsSchema, body: postMessageSchema }),
    handler,
  );
}

supportRouter.delete(
  "/admin/support/tickets/:id/messages/:messageId",
  authenticate,
  requirePermission("support", "update"),
  validate({ params: messageParamsSchema }),
  adminDeleteMessage,
);

supportRouter.post(
  "/admin/support/tickets/:id/read",
  authenticate,
  requirePermission("support", "read"),
  validate({ params: ticketParamsSchema }),
  adminReadTicket,
);

supportRouter.get(
  "/admin/support/tickets",
  authenticate,
  requirePermission("support", "read"),
  validate({ query: adminListTicketsQuerySchema }),
  adminListTickets,
);

supportRouter.post(
  "/admin/support/tickets",
  authenticate,
  requirePermission("support", "create"),
  uploadAttachments(),
  validate({ body: adminCreateTicketSchema }),
  adminCreateTicket,
);

supportRouter.get(
  "/admin/support/assignees",
  authenticate,
  requirePermission("support", "read"),
  listAssignees,
);

supportRouter.get(
  "/admin/support/tickets/:id",
  authenticate,
  requirePermission("support", "read"),
  validate({ params: ticketParamsSchema }),
  adminGetTicket,
);

supportRouter.patch(
  "/admin/support/tickets/:id",
  authenticate,
  requirePermission("support", "update"),
  validate({ params: ticketParamsSchema, body: updateTicketSchema }),
  adminUpdateTicket,
);

supportRouter.post(
  "/admin/support/tickets/:id/assign",
  authenticate,
  requirePermission("support", "update"),
  validate({ params: ticketParamsSchema, body: assignTicketSchema }),
  assignTicket,
);

supportRouter.post(
  "/admin/support/tickets/:id/unassign",
  authenticate,
  requirePermission("support", "update"),
  validate({ params: ticketParamsSchema }),
  unassignTicket,
);

supportRouter.get(
  "/admin/support/categories",
  authenticate,
  requirePermission("support", "read"),
  adminListSupportCategories,
);

supportRouter.post(
  "/admin/support/categories",
  authenticate,
  requirePermission("support", "create"),
  validate({ body: createSupportCategorySchema }),
  createSupportCategory,
);

supportRouter.patch(
  "/admin/support/categories/:id",
  authenticate,
  requirePermission("support", "update"),
  validate({ params: idParamsSchema, body: updateSupportCategorySchema }),
  updateSupportCategory,
);

supportRouter.delete(
  "/admin/support/categories/:id",
  authenticate,
  requirePermission("support", "delete"),
  validate({ params: idParamsSchema }),
  deleteSupportCategory,
);
