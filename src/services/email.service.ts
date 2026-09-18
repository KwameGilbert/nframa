import { Resend } from "resend";

let client: Resend | undefined;

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  client ??= new Resend(apiKey);
  return client;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is not configured");
  }

  const { error } = await getClient().emails.send({ from, to, subject, html });

  if (error) {
    throw new Error(`Resend email send failed: ${error.message}`);
  }
}
