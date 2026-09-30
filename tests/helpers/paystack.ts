import { createHmac } from "node:crypto";

// State behind the Paystack mock in tests/setup.ts. Keyed by reference or email, so concurrent tests each
// steer only their own payments.

interface PaystackResult {
  status: string;
  amountPesewas: number;
  currency: string;
}

const initialized = new Map<string, number>(); // reference -> amount in pesewas
const forced = new Map<string, Partial<PaystackResult>>();
const failingEmails = new Set<string>();

export const paystackMock = {
  async initialize(input: { email: string; amountPesewas: number; reference: string }) {
    if (failingEmails.has(input.email)) {
      throw new Error("Paystack is unavailable");
    }
    initialized.set(input.reference, input.amountPesewas);
    return {
      authorizationUrl: `https://checkout.paystack.test/${input.reference}`,
      accessCode: `access-${input.reference}`,
      reference: input.reference,
    };
  },

  // By default a payment has gone through for exactly the amount it was started with.
  async verify(reference: string): Promise<PaystackResult> {
    const amountPesewas = initialized.get(reference);
    if (amountPesewas === undefined) {
      throw new Error("Transaction reference not found");
    }
    return { status: "success", amountPesewas, currency: "GHS", ...forced.get(reference) };
  },
};

// What Paystack will report for this reference from now on (e.g. a different amount, or "abandoned").
export function forcePaystackResult(reference: string, result: Partial<PaystackResult>) {
  forced.set(reference, result);
}

// Makes starting a payment fail for this payer email.
export function failPaystackInitFor(email: string) {
  failingEmails.add(email);
}

// What Paystack would send in x-paystack-signature for this exact body.
export function signPaystack(body: string, secret = process.env.PAYSTACK_SECRET_KEY ?? "") {
  return createHmac("sha512", secret).update(body).digest("hex");
}
