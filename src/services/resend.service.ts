import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

let client: Resend | undefined;

// This is the only file that knows Resend or its API key. Everything else sends mail through email.service.ts.
function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  client ??= new Resend(apiKey);
  return client;
}

export async function sendViaResend({ to, subject, html }: EmailMessage): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is not configured");
  }

  const { error } = await getClient().emails.send({ from, to, subject, html });

  if (error) {
    throw new Error(`Resend email send failed: ${error.message}`);
  }
}
