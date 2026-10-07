import { Expo, type ExpoPushMessage } from "expo-server-sdk";

// This is the only file that knows expo-server-sdk and EXPO_ACCESS_TOKEN. Callers never see a ticket's `message`
// (it contains the device token): only a short error code is kept.

export interface ExpoSendResult {
  token: string;
  ok: boolean;
  // Set when ok: look the delivery up later with fetchExpoReceipts.
  receiptId?: string;
  // Set when not ok: an Expo error code (DeviceNotRegistered, MessageRateExceeded, ...) or "InvalidToken".
  error?: string;
  // The token will never work again, so the device should be deleted.
  deviceGone?: boolean;
}

export interface ExpoReceiptResult {
  ok: boolean;
  error?: string;
  deviceGone?: boolean;
}

let client: Expo | undefined;

// The SDK's request errors can carry the request's tokens or the raw tickets (whose message holds a token), so
// only the error code and HTTP status leave this file.
async function cleanly<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const { code, statusCode } = err as { code?: string; statusCode?: number };
    // eslint-disable-next-line preserve-caught-error -- a cause would carry the tokens this function strips
    throw new Error(`Expo request failed (${code ?? statusCode ?? "unknown"})`);
  }
}

// Created on first use so a missing or late-set EXPO_ACCESS_TOKEN doesn't matter at import time.
function getClient(): Expo {
  client ??= new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
  return client;
}

// Up to 100 messages (Expo's per-request limit), each to one token. Results are in the same order as messages.
export async function sendExpoPush(
  messages: (ExpoPushMessage & { to: string })[],
): Promise<ExpoSendResult[]> {
  const results: ExpoSendResult[] = [];
  const valid: ExpoPushMessage[] = [];
  const validAt: number[] = [];

  messages.forEach((message, index) => {
    if (Expo.isExpoPushToken(message.to)) {
      valid.push(message);
      validAt.push(index);
    } else {
      results[index] = { token: message.to, ok: false, error: "InvalidToken", deviceGone: true };
    }
  });

  if (valid.length > 0) {
    const tickets = await cleanly(() => getClient().sendPushNotificationsAsync(valid));
    tickets.forEach((ticket, i) => {
      const index = validAt[i];
      const token = messages[index].to;
      if (ticket.status === "ok") {
        results[index] = { token, ok: true, receiptId: ticket.id };
      } else {
        const error = ticket.details?.error ?? "ExpoError";
        results[index] = { token, ok: false, error, deviceGone: error === "DeviceNotRegistered" };
      }
    });
  }

  return results;
}

// Keyed by receipt id. An id Expo has no receipt for yet is absent from the result.
export async function fetchExpoReceipts(
  receiptIds: string[],
): Promise<Record<string, ExpoReceiptResult>> {
  const expo = getClient();
  const out: Record<string, ExpoReceiptResult> = {};

  for (const chunk of expo.chunkPushNotificationReceiptIds(receiptIds)) {
    const receipts = await cleanly(() => expo.getPushNotificationReceiptsAsync(chunk));
    for (const [id, receipt] of Object.entries(receipts)) {
      if (receipt.status === "ok") {
        out[id] = { ok: true };
      } else {
        const error = receipt.details?.error ?? "ExpoError";
        out[id] = { ok: false, error, deviceGone: error === "DeviceNotRegistered" };
      }
    }
  }

  return out;
}
