import { AppError } from "../utils/AppError.js";
import type { SmsBalance, SmsProvider } from "./sms.service.js";

// SMSOnlineGH v5 REST API: https://dev.smsonlinegh.com/docs/v5/http/rest/index.html
const SMSONLINEGH_SEND_URL = "https://api.smsonlinegh.com/v5/message/sms/send";
const SMSONLINEGH_BALANCE_URL = "https://api.smsonlinegh.com/v5/account/balance";
const HANDSHAKE_OK = 0;
const GSM_TEXT = 0;

interface SmsOnlineGhResponse<T> {
  handshake?: { id?: number; label?: string };
  data?: T;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `key ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// Success is HTTP 200 plus handshake 0 (HSHK_OK); a 200 can still carry an error handshake.
function isOk(response: Response, body: SmsOnlineGhResponse<unknown> | null): boolean {
  return response.ok && body?.handshake?.id === HANDSHAKE_OK;
}

async function send(to: string, message: string): Promise<void> {
  const apiKey = process.env.SMSONLINEGH_API_KEY;
  const sender = process.env.SMSONLINEGH_SENDER_ID;

  if (!apiKey) {
    throw new Error("SMSONLINEGH_API_KEY is not configured");
  }

  const response = await fetch(SMSONLINEGH_SEND_URL, {
    method: "POST",
    headers: headers(apiKey),
    // Their examples use 233… or 0… numbers, so the + of our "+233…" identifiers is dropped
    body: JSON.stringify({
      text: message,
      type: GSM_TEXT,
      sender,
      destinations: [to.replace(/^\+/, "")],
    }),
  });

  const body = (await response.json().catch(() => null)) as SmsOnlineGhResponse<unknown> | null;
  if (!isOk(response, body)) {
    const handshake = body?.handshake
      ? `${body.handshake.id} ${body.handshake.label}`
      : "no handshake";
    throw new Error(`SMSOnlineGH SMS send failed (${response.status}, ${handshake})`);
  }
}

async function getBalance(): Promise<SmsBalance> {
  const apiKey = process.env.SMSONLINEGH_API_KEY;
  if (!apiKey) {
    throw new AppError("SMS is not configured", 503);
  }

  const response = await fetch(SMSONLINEGH_BALANCE_URL, {
    method: "POST",
    headers: headers(apiKey),
  }).catch(() => {
    throw AppError.badGateway("Couldn't reach the SMS provider, try again");
  });
  const body = (await response.json().catch(() => null)) as SmsOnlineGhResponse<{
    balance?: unknown;
    model?: unknown;
    currencyCode?: unknown;
  }> | null;
  const balance = Number(body?.data?.balance);
  if (!isOk(response, body) || !Number.isFinite(balance)) {
    throw AppError.badGateway(`The SMS provider couldn't report the balance (${response.status})`);
  }

  // A "quantity" account counts SMS units; a "currency" account holds money in currencyCode instead
  const { model, currencyCode } = body?.data ?? {};
  if (model === "quantity") {
    return { smsUnits: balance, mainBalance: "" };
  }
  return { smsUnits: 0, mainBalance: `${currencyCode ?? ""} ${balance}`.trim() };
}

export const smsOnlineGhProvider: SmsProvider = { send, getBalance };
