import { z } from "zod";
import { isAllowedWebPushHost } from "../config/notificationTypes.js";

const EXPO_PUSH_TOKEN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
const MAX_TOKEN_LENGTH = 2048;

// What a device is known by: an Expo push token, or a browser subscription's endpoint URL. Used to unregister one
// (here and at logout), so it accepts either form.
export const pushTokenSchema = z.string().min(1).max(MAX_TOKEN_LENGTH).meta({
  description:
    "The device's Expo push token, or for a browser the subscription's endpoint URL, exactly as registered with POST /devices",
  example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
});

const expoTokenSchema = z
  .string()
  .max(MAX_TOKEN_LENGTH)
  .regex(EXPO_PUSH_TOKEN, "Must be an Expo push token, e.g. ExponentPushToken[...]")
  .meta({
    description:
      "From expo-notifications' getExpoPushTokenAsync({ projectId }). Send it on every sign-in, cold start and token change",
    example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  });

// The server calls this URL to deliver, so it must be https on a known push service (no SSRF), on the default port
// with no user info, and already in the canonical form a URL parser gives it (exactly what browsers send), so
// web-push's own (legacy) parser can't read a different host.
function isPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      isAllowedWebPushHost(url.hostname) &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.href === value
    );
  } catch {
    return false;
  }
}

export const PUSH_ENDPOINT_RULE =
  "Must be the https endpoint exactly as the browser gives it, on a known push service (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com)";

const base64url = (length: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`), {
    message: `Must be ${length} base64url characters`,
  });

const webSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(MAX_TOKEN_LENGTH)
      .refine(isPushEndpoint, { message: PUSH_ENDPOINT_RULE })
      .meta({
        description:
          "The push service URL the browser subscribed to, exactly as subscription.toJSON() gives it: https, on a known push service, no port or user info, not rewritten (e.g. no upper-case host)",
        example:
          "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ",
      }),
    expirationTime: z.number().nullable().optional().meta({
      description: "As the browser reports it; not stored",
      example: null,
    }),
    keys: z.object({
      p256dh: base64url(87).meta({
        description: "The browser's P-256 public key (65 bytes, base64url, no padding)",
        example:
          "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      }),
      auth: base64url(22).meta({
        description: "The browser's auth secret (16 bytes, base64url, no padding)",
        example: "tBHItJI5svbpez7KI4CCXg",
      }),
    }),
  })
  .meta({
    description:
      "The browser's PushSubscription as subscription.toJSON() returns it; send it as is",
  });

const expoDeviceSchema = z.object({
  platform: z
    .enum(["ios", "android"])
    .meta({ description: "The app's platform", example: "android" }),
  token: expoTokenSchema,
});

const webDeviceSchema = z.object({
  platform: z.literal("web").meta({ description: "A browser (web push)", example: "web" }),
  subscription: webSubscriptionSchema,
});

export const registerDeviceSchema = z.discriminatedUnion("platform", [
  expoDeviceSchema,
  webDeviceSchema,
]);

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const unregisterDeviceSchema = z.object({
  token: pushTokenSchema,
});

export type UnregisterDeviceInput = z.infer<typeof unregisterDeviceSchema>;

// Responses (docs only — see CLAUDE.md "API docs"). The token, endpoint and keys are never returned.

export const deviceResponseSchema = z.object({
  id: z.uuid(),
  platform: z.enum(["ios", "android", "web"]),
  createdAt: z.iso.datetime().meta({
    description: "When this device was first registered (to its current owner or before)",
  }),
  updatedAt: z.iso.datetime().meta({
    description:
      "When the device last registered; one not seen for push.deviceStaleDays (45) stops getting pushes and is removed",
  }),
});

export const vapidKeyResponseSchema = z.object({
  publicKey: z.string().nullable().meta({
    description:
      "The applicationServerKey for pushManager.subscribe (base64url); null when web push isn't configured on this server",
    example:
      "BBv2rBboQDgcEFSLIhO3tGkrB_qZfKj12yc-3LcDF_WfV11qi84vrtA7nWYnbN3xvIdyf_mdgqs3Gk4iKs_n7Ek",
  }),
});
