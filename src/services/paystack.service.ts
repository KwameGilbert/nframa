import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../utils/AppError.js";

const BASE_URL = "https://api.paystack.co";
const TIMEOUT_MS = 10_000;

interface PaystackResponse<T> {
  status: boolean;
  message?: string;
  data?: T;
}

// This is the only file that knows Paystack's API or its secret key.
function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw AppError.serviceUnavailable("Payments are not configured");
  }
  return key;
}

// Lets callers refuse early, before recording anything, when payments can't work.
export function assertPaymentsConfigured() {
  secretKey();
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as PaystackResponse<T> | null;
  if (!res.ok || !body?.status || !body.data) {
    throw new Error(`Paystack ${path} responded ${res.status}: ${body?.message ?? "no body"}`);
  }
  return body.data;
}

export async function initializeTransaction(input: {
  email: string;
  amountPesewas: number;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const data = await call<{ authorization_url: string; access_code: string; reference: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amountPesewas,
        currency: "GHS",
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    },
  );
  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

// status is Paystack's: success, failed, reversed, abandoned, ongoing, pending, ...
export async function verifyTransaction(reference: string) {
  const data = await call<{ status: string; amount: number; currency: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return { status: data.status, amountPesewas: data.amount, currency: data.currency };
}

// Paystack signs each webhook with an HMAC-SHA512 of the raw body, keyed with the secret key.
export function verifyWebhookSignature(rawBody: Buffer | undefined, signature: unknown): boolean {
  const key = secretKey();
  if (!rawBody || typeof signature !== "string") return false;

  const expected = Buffer.from(createHmac("sha512", key).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
