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
  rateMyTicket,
  resolveMyTicket,
} from "../controllers/support.controller.js";
import {
  createTicketSchema,
  listMyTicketsQuerySchema,
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

// Staff.
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
