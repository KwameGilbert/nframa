const ARKESEL_API_URL = "https://sms.arkesel.com/api/v2/sms/send";

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
