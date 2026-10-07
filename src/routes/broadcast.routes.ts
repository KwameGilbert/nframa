import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import {
  cancelBroadcast,
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  listBroadcasts,
  previewAudience,
  scheduleBroadcast,
  smsBalance,
  updateBroadcast,
} from "../controllers/broadcast.controller.js";
import {
  audiencePreviewQuerySchema,
  broadcastParamsSchema,
  createBroadcastSchema,
  listBroadcastsQuerySchema,
  scheduleBroadcastSchema,
  updateBroadcastSchema,
} from "../schemas/broadcast.schema.js";

export const broadcastRouter = Router();

// The Broadcast Studio. read: the history, a broadcast and the audience preview. create: drafting. update: editing,
// scheduling and cancelling. delete: removing a draft.
broadcastRouter.get(
  "/admin/broadcasts",
  authenticate,
  requirePermission("broadcasts", "read"),
  validate({ query: listBroadcastsQuerySchema }),
  listBroadcasts,
);

// These two before /admin/broadcasts/:id, which would otherwise take "audience-preview" or "sms-balance" for an id.
broadcastRouter.get(
  "/admin/broadcasts/audience-preview",
  authenticate,
  requirePermission("broadcasts", "read"),
  validate({ query: audiencePreviewQuerySchema }),
  previewAudience,
);

broadcastRouter.get(
  "/admin/broadcasts/sms-balance",
  authenticate,
  requirePermission("broadcasts", "read"),
  smsBalance,
);

broadcastRouter.get(
  "/admin/broadcasts/:id",
  authenticate,
  requirePermission("broadcasts", "read"),
  validate({ params: broadcastParamsSchema }),
  getBroadcast,
);

broadcastRouter.post(
  "/admin/broadcasts",
  authenticate,
  requirePermission("broadcasts", "create"),
  validate({ body: createBroadcastSchema }),
  createBroadcast,
);

broadcastRouter.patch(
  "/admin/broadcasts/:id",
  authenticate,
  requirePermission("broadcasts", "update"),
  validate({ params: broadcastParamsSchema, body: updateBroadcastSchema }),
  updateBroadcast,
);

broadcastRouter.post(
  "/admin/broadcasts/:id/schedule",
  authenticate,
  requirePermission("broadcasts", "update"),
  validate({ params: broadcastParamsSchema, body: scheduleBroadcastSchema }),
  scheduleBroadcast,
);

broadcastRouter.post(
  "/admin/broadcasts/:id/cancel",
  authenticate,
  requirePermission("broadcasts", "update"),
  validate({ params: broadcastParamsSchema }),
  cancelBroadcast,
);

broadcastRouter.delete(
  "/admin/broadcasts/:id",
  authenticate,
  requirePermission("broadcasts", "delete"),
  validate({ params: broadcastParamsSchema }),
  deleteBroadcast,
);
