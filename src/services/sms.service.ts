import { AppError } from "../utils/AppError.js";

const ARKESEL_API_URL = "https://sms.arkesel.com/api/v2/sms/send";
const ARKESEL_BALANCE_URL = "https://sms.arkesel.com/api/v2/clients/balance-details";

export async function sendSms(to: string, message: string): Promise<void> {
  const apiKey = process.env.ARKESEL_API_KEY;
  const sender = process.env.ARKESEL_SENDER_ID;

  if (!apiKey) {
    throw new Error("ARKESEL_API_KEY is not configured");
  }

  const response = await fetch(ARKESEL_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender,
      message,
      recipients: [to],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Arkesel SMS send failed (${response.status}): ${body}`);
  }
}

// What's left on the Arkesel account. Sign-in codes come out of the same units as broadcasts.
export async function getSmsBalance(): Promise<{ smsUnits: number; mainBalance: string }> {
  const apiKey = process.env.ARKESEL_API_KEY;
  if (!apiKey) {
    throw new AppError("SMS is not configured", 503);
  }

  const response = await fetch(ARKESEL_BALANCE_URL, { headers: { "api-key": apiKey } }).catch(
    () => {
      throw AppError.badGateway("Couldn't reach the SMS provider, try again");
    },
  );
  const body = (await response.json().catch(() => null)) as {
    data?: { sms_balance?: unknown; main_balance?: unknown };
  } | null;
  const units = Number(body?.data?.sms_balance);
  if (!response.ok || !Number.isFinite(units)) {
    throw AppError.badGateway(`The SMS provider couldn't report the balance (${response.status})`);
  }
  return { smsUnits: units, mainBalance: String(body?.data?.main_balance ?? "") };
}
