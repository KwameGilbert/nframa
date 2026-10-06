import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  deviceResponseSchema,
  registerDeviceSchema,
  unregisterDeviceSchema,
  vapidKeyResponseSchema,
} from "../schemas/device.schema.js";

const TAG = "Devices";
const unauthorized = errorResponse("Missing or invalid access token");
const LIMIT =
  "Rate limited per account (60 per 15 minutes, shared by POST /devices and POST /devices/unregister).";

registry.registerPath({
  method: "post",
  path: "/devices",
  tags: [TAG],
  summary: "Register this device for push notifications (any signed-in user)",
  description: `Any signed-in rider, driver or admin, for their own account. Phones (platform ios or android) send the Expo push token from expo-notifications' getExpoPushTokenAsync({ projectId }); browsers (platform web) send the PushSubscription from pushManager.subscribe, as subscription.toJSON() returns it (get the applicationServerKey from GET /push/vapid-key first). Register on every sign-in, cold start, return to the foreground and token change, and again after a password change or reset (those remove every device of the account): re-registering a token only refreshes it, and a device not seen for 45 days (setting push.deviceStaleDays) stops getting pushes and is removed. A token already registered to another account moves to the caller (a shared phone), and the previous account stops getting pushes on it. Up to 10 devices per account: registering one more drops the one seen longest ago. A web endpoint must be the https endpoint exactly as the browser gives it (no port, no user info, not rewritten, e.g. no upper-case host), on a known push service (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com), and its keys the browser's p256dh (87 base64url characters) and auth (22). The token, endpoint and keys are never returned. Recorded in the audit trail as device.register (token and subscription blanked) only when the device is new to the account, not on every refresh. To stop pushes on sign-out, send pushToken to POST /auth/logout. ${LIMIT}`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: registerDeviceSchema,
          examples: {
            expo: {
              summary: "Phone (Expo push token)",
              value: { platform: "android", token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" },
            },
            web: {
              summary: "Browser (subscription.toJSON())",
              value: {
                platform: "web",
                subscription: {
                  endpoint:
                    "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ",
                  expirationTime: null,
                  keys: {
                    p256dh:
                      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
                    auth: "tBHItJI5svbpez7KI4CCXg",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Device registered successfully", deviceResponseSchema),
    400: errorResponse(
      "Validation error: an unknown platform, a token that isn't an Expo push token, a web subscription without keys, an endpoint that isn't the https URL exactly as the browser gives it on a known push service, or keys of the wrong length",
      "token: Must be an Expo push token, e.g. ExponentPushToken[...]",
    ),
    401: unauthorized,
    429: rateLimitedResponse,
    503: errorResponse(
      "platform web while the server has no VAPID keys (GET /push/vapid-key returns null)",
      "Web push is not configured",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/devices/unregister",
  tags: [TAG],
  summary: "Stop push notifications to a device (any signed-in user)",
  description: `Removes the caller's own device registered with this token (the Expo push token, or a browser's subscription endpoint). Always 200, whether the token was registered, already removed, or belongs to another account (which is never touched), so the answer says nothing about any token. For a "turn off notifications" switch; on sign-out send pushToken to POST /auth/logout instead (one call). A POST with the token in the body, so it never sits in a URL. Recorded in the audit trail as device.unregister (token blanked) only when a device was removed. ${LIMIT}`,
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: unregisterDeviceSchema } } },
  },
  responses: {
    200: successResponse("Device unregistered successfully"),
    400: errorResponse("Validation error: a missing token, or one over 2048 characters"),
    401: unauthorized,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/push/vapid-key",
  tags: [TAG],
  summary: "Get the web push key (any signed-in user)",
  description:
    "The VAPID public key a browser passes to pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }) before registering with POST /devices (platform web). null when web push isn't configured on this server; POST /devices then answers 503 for web. The key only changes when the server's VAPID keys are rotated, which invalidates every web subscription: subscribe and register again. Phones don't need it. Not audited, not rate limited.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Web push key retrieved successfully", vapidKeyResponseSchema),
    401: unauthorized,
  },
});
