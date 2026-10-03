import { createLogger } from "../config/logger.js";
import { userModel } from "../models/user.model.js";
import { sendViaResend } from "./resend.service.js";

const logger = createLogger("app");

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Anything a person or an admin typed (names, reasons, labels) goes through this before it's put in a mail.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// Colours stay out of the all-digit form (#111827): tests read the code out of a mail by its six digits.
function layout(heading: string, bodyHtml: string) {
  return (
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">` +
    `<h2 style="margin:0 0 16px;color:#0f766e">${escapeHtml(heading)}</h2>` +
    `${bodyHtml}` +
    `<p style="margin-top:24px;font-size:12px;color:#6b7280">Nframa</p>` +
    `</div>`
  );
}

// The code goes to someone waiting for it, so a failed send throws and the request fails with it.
export function sendOtpEmail(to: string, label: string, code: string, expiryMinutes: number) {
  return sendViaResend({
    to,
    subject: `Your Nframa ${label}`,
    html: layout(
      `Your ${label}`,
      `<p>Your Nframa ${escapeHtml(label)} is <strong style="font-size:20px">${code}</strong>.</p>` +
        `<p>It expires in ${expiryMinutes} minutes. If you didn't ask for it, ignore this email.</p>`,
    ),
  });
}

// The notifications below are a courtesy on top of what the app already did (and of the in-app event), so
// they never fail the request: an account without an email address gets none, and a failed send is logged.
async function notifyUser(
  userId: string,
  build: (name: string) => { subject: string; heading: string; body: string },
) {
  try {
    const user = await userModel.findById(userId);
    if (!user?.email) return;

    const name = user.fullName?.trim().split(/\s+/)[0] ?? "there";
    const { subject, heading, body } = build(escapeHtml(name));
    await sendViaResend({ to: user.email, subject, html: layout(heading, body) });
  } catch (err) {
    logger.warn({ err, userId }, "Failed to send a notification email");
  }
}

export function sendAccountStatusEmail(
  userId: string,
  status: "active" | "suspended",
  reason?: string | null,
) {
  return notifyUser(userId, (name) =>
    status === "suspended"
      ? {
          subject: "Your Nframa account has been suspended",
          heading: "Account suspended",
          body:
            `<p>Hi ${name}, your Nframa account has been suspended and you've been signed out.</p>` +
            (reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : "") +
            `<p>If you think this is a mistake, contact Nframa support.</p>`,
        }
      : {
          subject: "Your Nframa account is active again",
          heading: "Account reactivated",
          body: `<p>Hi ${name}, your Nframa account has been reactivated. You can sign in again.</p>`,
        },
  );
}

const VERIFICATION_MESSAGES: Record<string, { subject: string; heading: string; body: string }> = {
  approved: {
    subject: "You're approved to drive with Nframa",
    heading: "You're approved",
    body: "your documents have been verified and your driver account is approved. You can now take bookings.",
  },
  rejected: {
    subject: "A driver document needs your attention",
    heading: "Document rejected",
    body: "one of your documents was rejected. Open the app to see why and upload a new one.",
  },
  expiring: {
    subject: "A driver document has expired",
    heading: "Document expired",
    body: "one of your documents has expired. Upload a renewed one to keep your approval.",
  },
};

// Only the outcomes a driver acts on: moving between unverified and pending isn't worth an email.
export function sendDriverVerificationEmail(userId: string, status: string) {
  const message = VERIFICATION_MESSAGES[status];
  if (!message) return Promise.resolve();

  return notifyUser(userId, (name) => ({
    ...message,
    body: `<p>Hi ${name}, ${message.body}</p>`,
  }));
}

export function sendTopUpEmail(userId: string, amount: number, currency: string) {
  return notifyUser(userId, (name) => ({
    subject: "Your Nframa wallet was topped up",
    heading: "Wallet topped up",
    body: `<p>Hi ${name}, ${escapeHtml(currency)} ${amount.toFixed(2)} was added to your Nframa wallet.</p>`,
  }));
}

// Staff verify payment methods for now; the owner can't use one for payouts until then.
export function sendPaymentMethodReviewEmail(
  userId: string,
  label: string,
  status: "verified" | "failed",
) {
  return notifyUser(userId, (name) =>
    status === "verified"
      ? {
          subject: "Your payment method is verified",
          heading: "Payment method verified",
          body: `<p>Hi ${name}, your payment method <strong>${escapeHtml(label)}</strong> is verified and ready to use.</p>`,
        }
      : {
          subject: "Your payment method couldn't be verified",
          heading: "Payment method not verified",
          body: `<p>Hi ${name}, we couldn't verify your payment method <strong>${escapeHtml(label)}</strong>. Remove it and save it again with the correct details.</p>`,
        },
  );
}
