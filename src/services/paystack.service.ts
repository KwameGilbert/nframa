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

// Payment method tokenization

interface TokenizeCardInput {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  cardholderName: string;
}

interface TransferInput {
  recipientToken: string;
  amount: number;
  currency: string;
  reference: string;
  description?: string;
}

export async function tokenizeCard(input: TokenizeCardInput): Promise<string> {
  const data = await call<{ authorization_url?: string; access_code?: string }>(
    "/transaction/charge_authorization",
    {
      method: "POST",
      body: JSON.stringify({
        email: "payment@example.com",
        amount: 0,
        authorization_code: input.cardNumber,
        card: {
          number: input.cardNumber,
          cvv: input.cvv,
          expiry_month: String(input.expiryMonth).padStart(2, "0"),
          expiry_year: String(input.expiryYear),
        },
      }),
    },
  );
  return (data.authorization_url || data.access_code) as string;
}

export async function tokenizeMobileMoney(phoneNumber: string, operator: string): Promise<string> {
  const data = await call<{ reference: string }>(
    "/transfer/initiate",
    {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: 0,
        recipient: phoneNumber,
        reason: "mobile_money_tokenization",
        metadata: { operator },
      }),
    },
  );
  return data.reference;
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const data = await call<{ status: string }>(
      `/transaction/verify/${encodeURIComponent(token)}`,
    );
    return data.status === "success";
  } catch {
    return false;
  }
}

export async function transferFunds(input: TransferInput): Promise<{
  success: boolean;
  transactionId: string;
}> {
  const data = await call<{ transfer_code?: string; reference?: string; id?: number }>(
    "/transfer",
    {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        reason: input.description || "Driver payout",
        amount: Math.round(input.amount * 100),
        recipient: input.recipientToken,
        reference: input.reference,
        currency: input.currency,
      }),
    },
  );

  return {
    success: true,
    transactionId: (data.transfer_code || data.reference || String(data.id)) as string,
  };
}
