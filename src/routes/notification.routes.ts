import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { notificationLimit } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notification.controller.js";
import {
  listNotificationsQuerySchema,
  notificationParamsSchema,
} from "../schemas/notification.schema.js";

export const notificationRouter = Router();

// authenticate only: the caller's own inbox, taken from the access token.
notificationRouter.get(
  "/notifications",
  authenticate,
  notificationLimit,
  validate({ query: listNotificationsQuerySchema }),
  listNotifications,
);

notificationRouter.post(
  "/notifications/read-all",
  authenticate,
  notificationLimit,
  markAllNotificationsRead,
);

notificationRouter.post(
  "/notifications/:id/read",
  authenticate,
  notificationLimit,
  validate({ params: notificationParamsSchema }),
  markNotificationRead,
);

notificationRouter.delete(
  "/notifications/:id",
  authenticate,
  notificationLimit,
  validate({ params: notificationParamsSchema }),
  deleteNotification,
);
