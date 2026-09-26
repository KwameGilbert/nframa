import { vi } from "vitest";
import { sendSms } from "../../src/services/sms.service.js";
import { sendEmail } from "../../src/services/email.service.js";

// sendSms and sendEmail are mocked in tests/setup.ts; these read what the app would have sent.

function messagesTo(recipient: string): string[] {
  return [
    ...vi
      .mocked(sendSms)
      .mock.calls.filter(([to]) => to === recipient)
      .map(([, message]) => message),
    ...vi
      .mocked(sendEmail)
      .mock.calls.filter(([to]) => to === recipient)
      .map(([, , html]) => html),
  ];
}

export function messageCountTo(recipient: string) {
  return messagesTo(recipient).length;
}

// Runs send (a request that should send a code) and returns the new 6-digit code sent to recipient: a full
// phone number (+233241234567) or an email. Waits for it, since some codes are sent in the background.
export async function captureCode(
  recipient: string,
  send: () => PromiseLike<unknown>,
): Promise<string> {
  const before = messageCountTo(recipient);
  await send();

  // Background sends (forgot password) wait on a database insert, and other tests share the event loop,
  // so allow well over waitFor's 1s default.
  return vi.waitFor(
    () => {
      const messages = messagesTo(recipient);
      if (messages.length === before) {
        throw new Error(`No code was sent to ${recipient}`);
      }
      const code = messages.at(-1)?.match(/\b(\d{6})\b/)?.[1];
      if (!code) {
        throw new Error(`The last message to ${recipient} has no code`);
      }
      return code;
    },
    { timeout: 10_000, interval: 50 },
  );
}

// A code that's guaranteed not to be the real one.
export function wrongCode(code: string) {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}
