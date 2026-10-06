import { randomBytes, randomUUID, createECDH } from "node:crypto";
import { Expo, type ExpoPushErrorReceipt } from "expo-server-sdk";
import type { ExpoReceiptResult, ExpoSendResult } from "../../src/services/expo.service.js";
import type { WebPushResult, WebPushSubscription } from "../../src/services/webPush.service.js";

// State behind the Expo and web-push mocks in tests/setup.ts. Keyed by token, endpoint or receipt id, so concurrent
// tests each steer and inspect only their own devices. Nothing is ever cleared: filter by recipient instead.
// setup.ts imports only this file: it must never import the database or cleanup.ts (an import cycle hangs vitest).

export type ExpoErrorCode = NonNullable<NonNullable<ExpoPushErrorReceipt["details"]>["error"]>;

// "throw" makes the whole Expo call reject; an error code makes that token's ticket (or receipt) fail with it.
type ExpoOutcome = "ok" | "throw" | ExpoErrorCode;
// "missing": Expo has no receipt for the id yet.
type ReceiptOutcome = "ok" | "missing" | ExpoErrorCode;
type WebOutcome = "ok" | "gone" | "error" | "throw";

interface ExpoMessage {
  to: string;
  [key: string]: unknown;
}
interface WebPushCall {
  subscription: WebPushSubscription;
  payload: Record<string, unknown>;
  options: { urgency: string; ttl: number };
}

const expoSent: ExpoMessage[] = [];
const webSent: WebPushCall[] = [];
const expoOutcomes = new Map<string, ExpoOutcome>();
const webOutcomes = new Map<string, WebOutcome>();
const receiptOutcomes = new Map<string, ReceiptOutcome>();
const issuedReceipts = new Set<string>();

export const expoMock = {
  async send(messages: ExpoMessage[]): Promise<ExpoSendResult[]> {
    const outcomes = messages.map((message) => expoOutcomes.get(message.to) ?? "ok");
    if (outcomes.includes("throw")) throw new Error("Expo is unavailable");

    return messages.map((message, i) => {
      const token = message.to;
      if (!Expo.isExpoPushToken(token)) {
        return { token, ok: false, error: "InvalidToken", deviceGone: true };
      }
      expoSent.push(message);
      const outcome = outcomes[i];
      if (outcome !== "ok") {
        return { token, ok: false, error: outcome, deviceGone: outcome === "DeviceNotRegistered" };
      }
      const receiptId = randomUUID();
      issuedReceipts.add(receiptId);
      return { token, ok: true, receiptId };
    });
  },

  // An issued receipt is ok unless forced; an id nobody was issued has no receipt (absent), like Expo.
  async receipts(receiptIds: string[]): Promise<Record<string, ExpoReceiptResult>> {
    const out: Record<string, ExpoReceiptResult> = {};
    for (const id of receiptIds) {
      const outcome = receiptOutcomes.get(id) ?? "ok";
      if (!issuedReceipts.has(id) || outcome === "missing") continue;
      out[id] =
        outcome === "ok"
          ? { ok: true }
          : { ok: false, error: outcome, deviceGone: outcome === "DeviceNotRegistered" };
    }
    return out;
  },
};

export const webPushMock = {
  async send(
    subscription: WebPushSubscription,
    payload: Record<string, unknown>,
    options: { urgency: string; ttl: number },
  ): Promise<WebPushResult> {
    webSent.push({ subscription, payload, options });
    const outcome = webOutcomes.get(subscription.endpoint) ?? "ok";
    if (outcome === "throw") throw new Error("Web push is unavailable");
    if (outcome === "gone") return { ok: false, gone: true };
    if (outcome === "error") return { ok: false, gone: false };
    return { ok: true };
  },
};

// A well-formed Expo token nobody else uses.
export function newExpoToken(): string {
  return `ExponentPushToken[${randomUUID().replaceAll("-", "")}]`;
}

// A browser subscription with real P-256 keys (the sizes the API checks) on an allowed push host.
export function newWebSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

// What Expo reports for this token's tickets from now on.
export function forceExpo(token: string, outcome: ExpoOutcome) {
  expoOutcomes.set(token, outcome);
}

// What the push service reports for this web endpoint from now on.
export function forceWeb(endpoint: string, outcome: WebOutcome) {
  webOutcomes.set(endpoint, outcome);
}

// What Expo's receipt says for a receipt id from now on.
export function forceExpoReceipt(receiptId: string, outcome: ReceiptOutcome) {
  receiptOutcomes.set(receiptId, outcome);
}

// Every valid message sent to this token so far (a malformed token is never recorded as sent).
export function expoPushesTo(token: string) {
  return expoSent.filter((message) => message.to === token);
}

// Every web push sent to this endpoint so far.
export function webPushesTo(endpoint: string) {
  return webSent.filter((call) => call.subscription.endpoint === endpoint);
}

// Issue a receipt id without sending a push (for testing receipt processing in isolation).
export function issueExpoReceipt(): string {
  const id = randomUUID();
  issuedReceipts.add(id);
  return id;
}
