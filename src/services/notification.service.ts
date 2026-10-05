import { createLogger } from "../config/logger.js";
import {
  NOTIFICATION_TYPES,
  PRIVATE_PUSH,
  PUSH_DATA_KEYS,
  type NotificationType,
  type PushDataKey,
} from "../config/notificationTypes.js";
import type { Module } from "../config/permissions.js";
import {
  notificationModel,
  toNotificationView,
  type Notification,
} from "../models/notification.model.js";
import { pushDeviceModel, type PushDevice, type WebPushKeys } from "../models/pushDevice.model.js";
import { rolePermissionModel } from "../models/rolePermission.model.js";
import { settingModel } from "../models/setting.model.js";
import { userModel } from "../models/user.model.js";
import { sendExpoPush } from "./expo.service.js";
import { enqueueExpoReceipts, type ExpoReceiptEntry } from "./pushReceipts.service.js";
import { emitToUser } from "./socket.service.js";
import { sendWebPush } from "./webPush.service.js";

// Delivers a notification: the inbox row, the live `notification:new` event and the pushes. A side effect after the
// commit, like logActivity: callers `void` it after sendSuccess, never inside a transaction, and it never rejects,
// so a failed delivery can't touch the response or the data already committed. Delivery is at-most-once. Wording
// lives in notificationEvents.service.ts. Tokens, endpoints and keys are never logged.

const logger = createLogger("app");
const pending = new Set<Promise<void>>();

// Expo's per-request limit.
const EXPO_BATCH = 100;

export interface NotificationContent {
  title: string;
  body: string;
  // Ids only: anything not in PUSH_DATA_KEYS is dropped.
  data?: Partial<Record<PushDataKey, string>>;
}

// A builder runs inside the delivery, so an error building the text is logged instead of escaping to the caller.
export type ContentSource =
  NotificationContent | (() => NotificationContent | Promise<NotificationContent>);

export interface DeliveryOptions {
  // Push to these devices instead of the user's registered ones (e.g. the ones just removed at suspension).
  devices?: PushDevice[];
  // Deliver even though the account is suspended (only the suspension notice itself).
  allowSuspended?: boolean;
}

type Message = Required<NotificationContent>;

// Resolves once every delivery started so far has finished. Tests and cleanup wait on this instead of sleeping.
export async function flushNotifications() {
  await Promise.all([...pending]);
}

// Registered synchronously, so a flush right after the call (controllers don't await between sendSuccess and
// the notify) still waits for it.
function track(context: Record<string, string>, work: () => Promise<void>): Promise<void> {
  const run: Promise<void> = Promise.resolve()
    .then(work)
    .catch((err: unknown) => logger.warn({ err, ...context }, "Failed to deliver a notification"))
    .finally(() => pending.delete(run));
  pending.add(run);
  return run;
}

// Payloads travel through Expo, APNs and FCM in plaintext, so only the allow-listed ids survive.
async function resolve(content: ContentSource): Promise<Message> {
  const { title, body, data = {} } = typeof content === "function" ? await content() : content;
  const ids = Object.fromEntries(
    PUSH_DATA_KEYS.filter((key) => typeof data[key] === "string").map((key) => [key, data[key]]),
  );
  return { title, body, data: ids };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// One user's devices. Expo (ios, android) in batches, never mixing users: Expo refuses a request spanning projects,
// and the rider and driver apps are different ones. Each web subscription is its own call. A dead token is deleted.
async function push(
  userId: string,
  type: NotificationType,
  { title, body, data }: Message,
  devices: PushDevice[],
  { notificationId, badge }: { notificationId?: string; badge?: number } = {},
) {
  if (devices.length === 0) return;

  const spec = NOTIFICATION_TYPES[type];
  const isPrivate = spec.lockScreen === "private";
  const shown = isPrivate ? PRIVATE_PUSH : { title, body };
  // A private push's status would give away the outcome its generic text hides; the inbox row keeps it.
  const ids = isPrivate
    ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== "status"))
    : data;
  const payloadData = { ...ids, type, ...(notificationId && { notificationId }) };
  const gone: string[] = [];
  const receipts: ExpoReceiptEntry[] = [];

  const expoSends = chunks(
    devices.filter((device) => device.platform !== "web"),
    EXPO_BATCH,
  ).map(async (batch) => {
    const results = await sendExpoPush(
      batch.map((device) => ({
        to: device.token,
        ...shown,
        data: payloadData,
        channelId: spec.channel,
        priority: spec.priority,
        ttl: spec.ttl,
        sound: "default",
        ...(badge !== undefined && { badge }),
      })),
    );
    for (const { token, ok, receiptId, error, deviceGone } of results) {
      if (ok) {
        if (receiptId) receipts.push({ receiptId, token });
      } else if (deviceGone) {
        gone.push(token);
      } else {
        // InvalidCredentials: the FCM or APNs credentials on Expo are wrong, so nothing reaches that platform.
        const level = error === "InvalidCredentials" ? "error" : "warn";
        logger[level]({ userId, type, code: error }, "Expo refused a push");
      }
    }
  });

  const webSends = devices
    .filter((device) => device.platform === "web")
    .map(async (device) => {
      const result = await sendWebPush(
        { endpoint: device.token, keys: device.webKeys as WebPushKeys },
        { ...shown, data: payloadData },
        { urgency: spec.priority, ttl: spec.ttl },
      );
      if (!result.ok && result.gone) gone.push(device.token);
    });

  for (const outcome of await Promise.allSettled([...expoSends, ...webSends])) {
    if (outcome.status === "rejected") {
      logger.warn({ err: outcome.reason, userId, type }, "A push provider call failed");
    }
  }

  if (receipts.length > 0) enqueueExpoReceipts(receipts);
  // The query error would quote the tokens, so only its code is logged.
  await pushDeviceModel
    .removeByTokens(gone)
    .catch((err: { code?: string }) =>
      logger.warn({ userId, type, code: err.code }, "Failed to remove dead push devices"),
    );
}

// Skips a deleted account, and a suspended one unless allowSuspended. An inbox-worthy type gets its row (pruning
// the user's rows past notifications.retentionDays) and the socket event first; a failed inbox write is logged and
// the push still goes.
export function deliverNotification(
  userId: string,
  type: NotificationType,
  content: ContentSource,
  { devices, allowSuspended = false }: DeliveryOptions = {},
): Promise<void> {
  return track({ userId, type }, async () => {
    const message = await resolve(content);
    const settings = settingModel.getValues([
      "push.deviceStaleDays",
      "notifications.retentionDays",
    ]);
    const [user, targets, { "notifications.retentionDays": retentionDays }] = await Promise.all([
      userModel.findById(userId),
      devices ??
        settings.then((values) =>
          pushDeviceModel.listTargetsForUser(userId, values["push.deviceStaleDays"]),
        ),
      settings,
    ]);
    if (!user || user.deletedAt) return;
    if (user.status !== "active" && !allowSuspended) return;

    let notification: Notification | undefined;
    let unreadCount: number | undefined;
    if (NOTIFICATION_TYPES[type].inbox) {
      try {
        notification = await notificationModel.create({ userId, type, ...message });
        await notificationModel.pruneOlderThan(userId, retentionDays);
        unreadCount = await notificationModel.unreadCount(userId);
        emitToUser(userId, "notification:new", {
          notification: toNotificationView(notification),
          unreadCount,
        });
      } catch (err) {
        logger.warn({ err, userId, type }, "Failed to write an inbox notification");
      }
    }

    await push(userId, type, message, targets, {
      notificationId: notification?.id,
      badge: unreadCount,
    });
  });
}

// A staff desk alert: a push to every active admin whose role can read the module, read per call so a role edit
// or a suspension applies to the next alert. No inbox row and no socket event (the queue and the desk room are
// the record).
export function deliverToDesk(
  module: Module,
  type: NotificationType,
  content: ContentSource,
): Promise<void> {
  return track({ module, type }, async () => {
    const message = await resolve(content);
    const [adminIds, staleDays] = await Promise.all([
      rolePermissionModel.adminUserIdsWithPermission(module),
      settingModel.getValue("push.deviceStaleDays"),
    ]);
    const devices = await pushDeviceModel.listTargetsForUsers(adminIds, staleDays);

    await Promise.all(
      adminIds.map((adminId) =>
        push(
          adminId,
          type,
          message,
          devices.filter((device) => device.userId === adminId),
        ),
      ),
    );
  });
}
