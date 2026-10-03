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

const money = (amount: number, currency = "GHS") => `${escapeHtml(currency)} ${amount.toFixed(2)}`;

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

// Everything below is a courtesy on top of what the app already did (and of the in-app event), so it never
// fails the request: an account without an email address gets none, and a failed send is logged. Callers
// don't await these (`void sendXEmail(...)`), after the response, like logActivity.

interface Mail {
  subject: string;
  heading: string;
  body: string;
}

// `name` is the account's first name, already escaped.
async function notifyUser(userId: string, build: (name: string) => Mail) {
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

// For an address that isn't the account's current one (the old email after a change).
async function notifyAddress(to: string, build: () => Mail) {
  try {
    const { subject, heading, body } = build();
    await sendViaResend({ to, subject, html: layout(heading, body) });
  } catch (err) {
    logger.warn({ err }, "Failed to send a notification email");
  }
}

// --- Account

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

// Security notices: nobody asked for these, so they say what happened and who to tell if it wasn't them.
const NOT_YOU = "<p>If this wasn't you, contact Nframa support right away.</p>";

export function sendPasswordChangedEmail(userId: string) {
  return notifyUser(userId, (name) => ({
    subject: "Your Nframa password was changed",
    heading: "Password changed",
    body: `<p>Hi ${name}, the password on your Nframa account was just changed and you've been signed out on your other devices.</p>${NOT_YOU}`,
  }));
}

// Goes to the address the account had before the change, so whoever owned it hears about it. `what` is e.g.
// "email address" or "email address and phone number".
export function sendContactChangedEmail(to: string, what: string) {
  return notifyAddress(to, () => ({
    subject: "Your Nframa account details were changed",
    heading: "Account details changed",
    body: `<p>The ${escapeHtml(what)} on your Nframa account was just changed.</p>${NOT_YOU}`,
  }));
}

export function sendAccountDeletedEmail(userId: string) {
  return notifyUser(userId, (name) => ({
    subject: "Your Nframa account was deleted",
    heading: "Account deleted",
    body: `<p>Hi ${name}, your Nframa account has been deleted and you've been signed out everywhere.</p>${NOT_YOU}`,
  }));
}

export function sendAdminAccessEmail(
  userId: string,
  change: "granted" | "changed",
  roleName: string | null,
  status?: string,
) {
  const granted = change === "granted";
  return notifyUser(userId, (name) => ({
    subject: granted ? "You now have Nframa admin access" : "Your Nframa admin access changed",
    heading: granted ? "Admin access granted" : "Admin access changed",
    body:
      `<p>Hi ${name}, ` +
      (granted
        ? "admin access was set up for your Nframa account."
        : "your Nframa admin access was updated.") +
      `</p>` +
      (roleName ? `<p>Role: <strong>${escapeHtml(roleName)}</strong></p>` : "") +
      (status ? `<p>Status: <strong>${escapeHtml(status)}</strong></p>` : ""),
  }));
}

// --- Driver verification

const VERIFICATION_MESSAGES: Record<string, Mail> = {
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

// --- Wallet and payments

export function sendTopUpEmail(userId: string, amount: number, currency: string) {
  return notifyUser(userId, (name) => ({
    subject: "Your Nframa wallet was topped up",
    heading: "Wallet topped up",
    body: `<p>Hi ${name}, ${money(amount, currency)} was added to your Nframa wallet.</p>`,
  }));
}

export function sendTopUpFailedEmail(userId: string, amount: number, currency: string) {
  return notifyUser(userId, (name) => ({
    subject: "Your Nframa wallet top-up didn't go through",
    heading: "Top-up failed",
    body:
      `<p>Hi ${name}, your top-up of ${money(amount, currency)} couldn't be completed, so nothing was added to your wallet.</p>` +
      `<p>If money left your account, contact Nframa support with the time of the payment.</p>`,
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

// Where a driver's earnings go is the thing an account thief changes first.
export function sendPayoutMethodEmail(userId: string, label: string, action: "added" | "removed") {
  return notifyUser(userId, (name) => ({
    subject: `A payout method was ${action} on your Nframa account`,
    heading: `Payout method ${action}`,
    body: `<p>Hi ${name}, <strong>${escapeHtml(label)}</strong> was ${action} as a way to receive your earnings.</p>${NOT_YOU}`,
  }));
}

// --- Trips

// What a trip mail needs from a trip row; kept apart from the model's type so this file doesn't depend on it.
export interface TripEmailDetails {
  status: string;
  tripDate: string;
  scheduledPickupAt: Date;
  pickupAddress: string;
  dropoffAddress: string;
  totalAmount: number;
  driverEarnings: number;
  cancellationReason?: string | null;
}

export type TripEmailEvent =
  | "requested"
  | "accepted"
  | "declined"
  | "cancelled"
  | "noShow"
  | "completedRider"
  | "completedDriver";

const CANCELLED_BY: Record<string, string> = {
  rider: "the rider",
  driver: "the driver",
  admin: "Nframa support",
  system: "Nframa",
};

// Service time is Ghana (UTC+0), so the stored UTC time is the local one.
function tripSummary(trip: TripEmailDetails) {
  return (
    `<p><strong>${escapeHtml(trip.pickupAddress)}</strong> to <strong>${escapeHtml(trip.dropoffAddress)}</strong><br>` +
    `${trip.tripDate} at ${trip.scheduledPickupAt.toISOString().slice(11, 16)}</p>`
  );
}

export function sendTripEmail(
  userId: string,
  event: TripEmailEvent,
  trip: TripEmailDetails,
  cancelledBy?: string | null,
) {
  const reason = trip.cancellationReason
    ? `<p>Reason: ${escapeHtml(trip.cancellationReason)}</p>`
    : "";

  return notifyUser(userId, (name): Mail => {
    const hi = `<p>Hi ${name}, `;
    switch (event) {
      case "requested": {
        const booked = trip.status === "accepted";
        return {
          subject: booked ? "New booking on your commute" : "New booking request",
          heading: booked ? "New booking" : "New booking request",
          body:
            hi +
            (booked
              ? "a rider booked a seat on your commute."
              : "a rider asked for a seat on your commute. Open the app to accept or decline.") +
            `</p>${tripSummary(trip)}`,
        };
      }
      case "accepted":
        return {
          subject: "Your trip was accepted",
          heading: "Trip accepted",
          body:
            `${hi}your driver accepted your trip.</p>${tripSummary(trip)}` +
            `<p>${money(trip.totalAmount)} is held from your wallet and charged when you board.</p>`,
        };
      case "declined":
        return {
          subject: "Your trip request was declined",
          heading: "Trip declined",
          body: `${hi}the driver couldn't take your trip request.</p>${tripSummary(trip)}${reason}`,
        };
      case "cancelled":
        return {
          subject: "A trip was cancelled",
          heading: "Trip cancelled",
          body:
            `${hi}this trip was cancelled by ${CANCELLED_BY[cancelledBy ?? ""] ?? "Nframa"}.</p>` +
            `${tripSummary(trip)}${reason}`,
        };
      case "noShow":
        return {
          subject: "You were marked as a no-show",
          heading: "No-show reported",
          body:
            `${hi}your driver reported that you didn't show up for this trip. You weren't charged.</p>` +
            tripSummary(trip),
        };
      case "completedRider":
        return {
          subject: "Your trip is complete",
          heading: "Trip complete",
          body: `${hi}thanks for riding with Nframa.</p>${tripSummary(trip)}<p>Total charged: ${money(trip.totalAmount)}</p>`,
        };
      case "completedDriver":
        return {
          subject: "Trip complete: you've been paid",
          heading: "Trip complete",
          body: `${hi}this trip is complete.</p>${tripSummary(trip)}<p>${money(trip.driverEarnings)} was added to your wallet.</p>`,
        };
    }
  });
}

// --- Reviews

export function sendReviewEmail(userId: string, rating: number, tip: number) {
  return notifyUser(userId, (name) => ({
    subject: tip > 0 ? "You got a review and a tip" : "You got a new review",
    heading: tip > 0 ? "New review and tip" : "New review",
    body:
      `<p>Hi ${name}, you got a ${rating}-star rating on a recent trip.</p>` +
      (tip > 0 ? `<p>They also tipped you ${money(tip)}, added to your wallet.</p>` : ""),
  }));
}

// --- Safety

const SOS_MESSAGES: Record<string, Mail> = {
  triggered: {
    subject: "We received your SOS alert",
    heading: "SOS alert received",
    body: "your SOS alert was received and our safety team has been notified. If you're in immediate danger, call 112.",
  },
  underReview: {
    subject: "Your SOS alert is being handled",
    heading: "SOS alert under review",
    body: "our safety team is looking at your SOS alert right now.",
  },
  servicesContacted: {
    subject: "Emergency services were contacted",
    heading: "Emergency services contacted",
    body: "our safety team has contacted emergency services about your SOS alert.",
  },
  cancelledByAdmin: {
    subject: "Your SOS alert was cancelled",
    heading: "SOS alert cancelled",
    body: "our safety team has cancelled your SOS alert. If you still need help, raise a new alert or call 112.",
  },
  resolved: {
    subject: "Your SOS alert was closed",
    heading: "SOS alert resolved",
    body: "our safety team has closed your SOS alert. We hope you're safe.",
  },
};

export function sendSosEmail(userId: string, status: string) {
  const message = SOS_MESSAGES[status];
  if (!message) return Promise.resolve();

  return notifyUser(userId, (name) => ({ ...message, body: `<p>Hi ${name}, ${message.body}</p>` }));
}