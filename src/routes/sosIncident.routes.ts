import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { sosLimit } from "../middlewares/rateLimit.js";
import { requirePermission } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import {
  adminGetIncident,
  adminListIncidents,
  adminUpdateIncidentStatus,
  cancelSos,
  getActiveSos,
  triggerSos,
} from "../controllers/sosIncident.controller.js";
import {
  cancelSosSchema,
  listSosIncidentsQuerySchema,
  sosIncidentParamsSchema,
  triggerSosSchema,
  updateSosStatusSchema,
} from "../schemas/sosIncident.schema.js";

export const sosIncidentRouter = Router();

// User-facing emergency endpoints (riders and drivers)
sosIncidentRouter.post(
  "/safety/sos",
  authenticate,
  sosLimit,
  validate({ body: triggerSosSchema }),
  triggerSos,
);

sosIncidentRouter.get("/safety/sos/active", authenticate, getActiveSos);

sosIncidentRouter.patch(
  "/safety/sos/:id/cancel",
  authenticate,
  sosLimit,
  validate({ params: sosIncidentParamsSchema, body: cancelSosSchema }),
  cancelSos,
);

// Admin-facing operations & dispatch endpoints
sosIncidentRouter.get(
  "/admin/safety/incidents",
  authenticate,
  requirePermission("users", "read"),
  validate({ query: listSosIncidentsQuerySchema }),
  adminListIncidents,
);

sosIncidentRouter.get(
  "/admin/safety/incidents/:id",
  authenticate,
  requirePermission("users", "read"),
  validate({ params: sosIncidentParamsSchema }),
  adminGetIncident,
);

sosIncidentRouter.patch(
  "/admin/safety/incidents/:id",
  authenticate,
  requirePermission("users", "update"),
  validate({ params: sosIncidentParamsSchema, body: updateSosStatusSchema }),
  adminUpdateIncidentStatus,
);
