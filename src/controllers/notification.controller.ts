import type { Request, Response } from "express";
import { notificationModel, toNotificationView } from "../models/notification.model.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";
import type { ListNotificationsQuery } from "../schemas/notification.schema.js";

// The caller's own inbox (the rows deliverNotification writes). Another user's notification is answered 404, as if
// it didn't exist. Not audited: it is high-volume housekeeping of one's own messages, like sharing a location.

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

const notFound = (id: string) => AppError.notFound(`Notification not found: ${id}`);

export async function listNotifications(req: Request, res: Response) {
  const userId = callerId(req);
  const query = req.validated.query as ListNotificationsQuery;

  const [{ items, totalItems }, unreadCount] = await Promise.all([
    notificationModel.listForUser(userId, {
      page: query.page,
      limit: query.limit,
      unread: query.unread === undefined ? undefined : query.unread === "true",
      type: query.type,
    }),
    notificationModel.unreadCount(userId),
  ]);

  sendSuccess(res, "Notifications retrieved successfully", {
    items: items.map(toNotificationView),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
    unreadCount,
  });
}

// Idempotent: reading it again keeps the first readAt.
export async function markNotificationRead(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };

  const notification = await notificationModel.markRead(id, userId);
  if (!notification) {
    throw notFound(id);
  }

  sendSuccess(res, "Notification marked as read", {
    notification: toNotificationView(notification),
    unreadCount: await notificationModel.unreadCount(userId),
  });
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  const userId = callerId(req);

  const updatedCount = await notificationModel.markAllRead(userId);

  sendSuccess(res, "All notifications marked as read", {
    updatedCount,
    unreadCount: await notificationModel.unreadCount(userId),
  });
}

export async function deleteNotification(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };

  if (!(await notificationModel.remove(id, userId))) {
    throw notFound(id);
  }

  sendSuccess(res, "Notification deleted successfully", {
    unreadCount: await notificationModel.unreadCount(userId),
  });
}
