import webpush from "web-push";
import { createLogger } from "../config/logger.js";

// This is the only file that knows web-push and the VAPID env vars. web-push is CommonJS, hence the default import.
const log = createLogger("app");

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type WebPushResult = { ok: true } | { ok: false; gone: boolean };

function vapid() {
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = process.env;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : undefined;
}

export function isWebPushConfigured(): boolean {
  return vapid() !== undefined;
}

// What a browser needs for pushManager.subscribe; null when web push is not configured.
export function getVapidPublicKey(): string | null {
  return vapid()?.publicKey ?? null;
}

// Never throws for a provider refusal. gone is true only for 404/410 (the subscription is dead); 401/403 usually
// mean our VAPID setup is wrong, so they are logged and the subscription is kept.
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: Record<string, unknown>,
  { urgency, ttl }: { urgency: "very-low" | "low" | "normal" | "high"; ttl: number },
): Promise<WebPushResult> {
  const keys = vapid();
  if (!keys) return { ok: false, gone: false };

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: ttl,
      urgency,
      vapidDetails: {
        subject: keys.subject,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
    });
    return { ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 401 || statusCode === 403) {
      log.error({ statusCode }, "Web push rejected our VAPID credentials");
    } else if (statusCode !== 404 && statusCode !== 410) {
      log.warn({ statusCode }, "Web push failed");
    }
    return { ok: false, gone: statusCode === 404 || statusCode === 410 };
  }
}
