import type { Request, Response } from "express";
import { pushDeviceModel, toDeviceView } from "../models/pushDevice.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { getVapidPublicKey, isWebPushConfigured } from "../services/webPush.service.js";
import { AppError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";
import type { RegisterDeviceInput, UnregisterDeviceInput } from "../schemas/device.schema.js";

// Self-service: every route acts on the caller's own devices, taken from the access token. The token, endpoint
// and keys are secrets (whoever holds them can push to the device), so no response or audit entry carries them.
const DEVICE_ACTIVITY = { module: "notifications", targetType: "pushDevice" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

export async function registerDevice(req: Request, res: Response) {
  const userId = callerId(req);
  const input = req.validated.body as RegisterDeviceInput;

  if (input.platform === "web" && !isWebPushConfigured()) {
    throw AppError.serviceUnavailable("Web push is not configured");
  }

  const { device, isNew } = await pushDeviceModel.register(
    userId,
    input.platform === "web"
      ? { platform: "web", token: input.subscription.endpoint, webKeys: input.subscription.keys }
      : { platform: input.platform, token: input.token },
  );

  sendSuccess(res, "Device registered successfully", toDeviceView(device));

  // The apps re-register on every launch: only a new device (or one that changed hands) is worth an entry.
  if (isNew) {
    logActivity(req, {
      ...DEVICE_ACTIVITY,
      action: "device.register",
      description: `Registered a device for push notifications (${device.platform})`,
      targetId: device.id,
      after: toDeviceView(device),
      redact: ["token", "subscription"],
    });
  }
}

// Always 200, so the answer never tells whether a token is registered (or to whom).
export async function unregisterDevice(req: Request, res: Response) {
  const { token } = req.validated.body as UnregisterDeviceInput;

  const removed = await pushDeviceModel.removeByToken(token, callerId(req));

  sendSuccess(res, "Device unregistered successfully");

  if (removed) {
    logActivity(req, {
      ...DEVICE_ACTIVITY,
      action: "device.unregister",
      description: `Unregistered a device from push notifications (${removed.platform})`,
      targetId: removed.id,
      before: removed, // already the view: removeByToken returns only DEVICE_VIEW_COLUMNS
      redact: ["token"],
    });
  }
}

export function getVapidKey(_req: Request, res: Response) {
  sendSuccess(res, "Web push key retrieved successfully", { publicKey: getVapidPublicKey() });
}
