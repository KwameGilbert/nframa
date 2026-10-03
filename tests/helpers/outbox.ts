import { vi } from "vitest";
import { sendSms } from "../../src/services/sms.service.js";
import { sendViaResend } from "../../src/services/resend.service.js";

// sendSms and sendViaResend (Resend, behind email.service.ts) are mocked in tests/setup.ts; these read what the
// app would have sent.

function messagesTo(recipient: string): string[] {
  return [
    ...vi
      .mocked(sendSms)
      .mock.calls.filter(([to]) => to === recipient)
      .map(([, message]) => message),
    ...vi
      .mocked(sendViaResend)
      .mock.calls.filter(([{ to }]) => to === recipient)
      .map(([{ html }]) => html),
  ];
}

export function messageCountTo(recipient: string) {
  return messagesTo(recipient).length;
}

// Notification mails (suspended, trip accepted, ...) go to the same inboxes as codes, so a code is the newest
// message that has a six-digit number in it, not simply the newest message.
function codesTo(recipient: string): string[] {
  return messagesTo(recipient).flatMap((message) => message.match(/\b(\d{6})\b/)?.[1] ?? []);
}

// Runs send (a request that should send a code) and returns the new 6-digit code sent to recipient: a full
// phone number (+233241234567) or an email. Waits for it, since some codes are sent in the background.
export async function captureCode(
  recipient: string,
  send: () => PromiseLike<unknown>,
): Promise<string> {
  const before = codesTo(recipient).length;
  await send();

  // Background sends (forgot password) wait on a database insert, and other tests share the event loop,
  // so allow well over waitFor's 1s default.
  return vi.waitFor(
    () => {
      const codes = codesTo(recipient);
      if (codes.length === before) {
        throw new Error(`No code was sent to ${recipient}`);
      }
      return codes[codes.length - 1];
    },
    { timeout: 10_000, interval: 50 },
  );
}

// A code that's guaranteed not to be the real one.
export function wrongCode(code: string) {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}
