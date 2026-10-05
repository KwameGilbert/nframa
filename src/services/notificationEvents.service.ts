import type { PushDevice } from "../models/pushDevice.model.js";
import {
  deliverNotification,
  deliverToDesk,
  type NotificationContent,
} from "./notification.service.js";

// What each notification says; notification.service delivers it. Like email.service, every function returns a
// promise that never rejects, and callers `void notifyX(...)` after sendSuccess, outside any transaction. Text and
// data never carry a name, phone number, address, code or anything a person typed (reasons, descriptions, labels):
// pushes travel through Expo, APNs and FCM in plaintext.

type Notice = Omit<NotificationContent, "data">;

const NOT_YOU = "If this wasn't you, contact Nframa support right away.";

const money = (amount: number, currency = "GHS") => `${currency} ${amount.toFixed(2)}`;

// --- Trips

// What a trip notice needs from a trip row; kept apart from the model's type, like email.service.
export interface TripNotice {
  id: string;
  commuteId: string;
  status: string;
  tripDate: string;
  scheduledPickupAt: Date;
}

export type TripNoticeEvent =
  "requested" | "accepted" | "declined" | "cancelled" | "driverArrived" | "completed" | "noShow";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Mon 5 Oct, 07:30": the trip date and the pickup time in UTC, which is Ghana time.
function when({ tripDate, scheduledPickupAt }: TripNotice) {
  const day = new Date(`${tripDate}T00:00:00Z`);
  return (
    `${DAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}, ` +
    scheduledPickupAt.toISOString().slice(11, 16)
  );
}

const CANCELLED_BY = {
  rider: "The rider cancelled",
  driver: "Your driver cancelled",
  admin: "Nframa support cancelled",
};

export function notifyTrip(
  userId: string,
  event: TripNoticeEvent,
  trip: TripNotice,
  cancelledBy?: keyof typeof CANCELLED_BY,
) {
  return deliverNotification(userId, `trip.${event}` as const, (): NotificationContent => {
    const data = { tripId: trip.id, commuteId: trip.commuteId, tripDate: trip.tripDate };
    switch (event) {
      case "requested":
        return trip.status === "accepted"
          ? {
              title: "New booking",
              body: `A rider booked a seat on your commute for ${when(trip)}.`,
              data,
            }
          : {
              title: "New booking request",
              body: `A rider asked for a seat on ${when(trip)}. Open the app to accept or decline.`,
              data,
            };
      case "accepted":
        return {
          title: "Trip accepted",
          body: `Your driver accepted your trip for ${when(trip)}.`,
          data,
        };
      case "declined":
        return {
          title: "Trip declined",
          body: `Your driver couldn't take your trip for ${when(trip)}. You can book another ride.`,
          data,
        };
      case "cancelled":
        return {
          title: "Trip cancelled",
          body: `${cancelledBy ? CANCELLED_BY[cancelledBy] : "Nframa cancelled"} the trip for ${when(trip)}.`,
          data,
        };
      case "driverArrived":
        return {
          title: "Your driver has arrived",
          body: "Your driver is at the pickup point. Open the app to show your boarding code.",
          data: { tripId: trip.id },
        };
      case "completed":
        return {
          title: "Trip complete",
          body: "Thanks for riding with Nframa. Tap to rate your driver.",
          data: { tripId: trip.id },
        };
      case "noShow":
        return {
          title: "Marked as a no-show",
          body: `Your driver reported that you didn't show up for your trip on ${when(trip)}. You weren't charged.`,
          data,
        };
    }
  });
}

// --- Safety

const SOS_NOTICES: Record<string, Notice> = {
  underReview: {
    title: "SOS alert under review",
    body: "Our safety team is looking at your SOS alert right now.",
  },
  servicesContacted: {
    title: "Emergency services contacted",
    body: "Our safety team has contacted emergency services about your SOS alert.",
  },
  resolved: {
    title: "SOS alert resolved",
    body: "Our safety team has closed your SOS alert. We hope you're safe.",
  },
  cancelledByAdmin: {
    title: "SOS alert cancelled by Nframa",
    body: "Our safety team has cancelled your SOS alert. If you still need help, raise a new alert or call 112.",
  },
};

// The person who raised the alert, as staff move it (never on their own trigger or cancel). The push shows generic
// text; this text is only in the inbox.
export function notifySos(userId: string, incident: { id: string; status: string }) {
  const notice = SOS_NOTICES[incident.status];
  if (!notice) return Promise.resolve();

  return deliverNotification(userId, "sos.statusChanged", {
    ...notice,
    data: { incidentId: incident.id, status: incident.status },
  });
}

// Every admin who can read the sos module, for a newly raised alert.
export function notifySafetyDesk(incidentId: string) {
  return deliverToDesk("sos", "sos.deskAlert", {
    title: "New SOS alert",
    body: "An SOS alert needs attention. Open the safety desk.",
    data: { incidentId },
  });
}

const REPORT_NOTICES: Record<string, Notice> = {
  underReview: {
    title: "Your report is being reviewed",
    body: "Our team has started reviewing your report.",
  },
  resolved: {
    title: "Your report was resolved",
    body: "Our team has finished reviewing your report. Thank you for telling us.",
  },
  dismissed: {
    title: "Your report was closed",
    body: "Our team reviewed your report and closed it without further action.",
  },
};

// Only ever the reporter, never the reported person, and never staff's outcome message or notes. The push shows
// generic text; this text is only in the inbox.
export function notifyReport(userId: string, report: { id: string; status: string }) {
  const notice = REPORT_NOTICES[report.status];
  if (!notice) return Promise.resolve();

  return deliverNotification(userId, "report.statusChanged", {
    ...notice,
    data: { reportId: report.id, status: report.status },
  });
}

// Every admin who can read the reports module, for an urgent report only.
export function notifyReportsDesk(report: { id: string; severity: string }) {
  if (report.severity !== "urgent") return Promise.resolve();

  return deliverToDesk("reports", "report.deskUrgent", {
    title: "New urgent report",
    body: "An urgent trip report was filed. Open the reports queue.",
    data: { reportId: report.id },
  });
}

// --- Account

const ACCOUNT_NOTICES = {
  suspended: {
    title: "Account suspended",
    body: "Your Nframa account has been suspended and you've been signed out. Contact support if you think this is a mistake.",
  },
  reactivated: {
    title: "Account reactivated",
    body: "Your Nframa account has been reactivated. You can sign in.",
  },
  passwordChanged: {
    title: "Password changed",
    body: `The password on your Nframa account was changed and you've been signed out. ${NOT_YOU}`,
  },
  contactChanged: {
    title: "Account details changed",
    body: `The email address or phone number on your account was changed. ${NOT_YOU}`,
  },
} satisfies Record<string, Notice>;

// devices: the ones just signed out (suspension, password change), which would otherwise get nothing. The
// suspension notice is the one thing a suspended account receives.
export function notifyAccount(
  userId: string,
  event: keyof typeof ACCOUNT_NOTICES,
  { devices }: { devices?: PushDevice[] } = {},
) {
  return deliverNotification(userId, `account.${event}` as const, ACCOUNT_NOTICES[event], {
    devices,
    allowSuspended: event === "suspended",
  });
}

// No role name: it says what changed, not what the access now is.
export function notifyAdminAccess(userId: string, change: "granted" | "changed") {
  return deliverNotification(
    userId,
    "account.adminAccess",
    change === "granted"
      ? { title: "Admin access granted", body: "Admin access was set up for your Nframa account." }
      : { title: "Admin access changed", body: "Your Nframa admin access was updated." },
  );
}

// --- Driver verification
const VERIFICATION_NOTICES: Record<string, Notice> = {
  approved: {
    title: "You're approved to drive",
    body: "Your documents have been verified and your driver account is approved. You can now take bookings.",
  },
  rejected: {
    title: "A document was rejected",
    body: "One of your documents was rejected. Open the app to see why and upload a new one.",
  },
  expiring: {
    title: "A document has expired",
    body: "One of your documents has expired. Upload a renewed one to keep your approval.",
  },
};

// Only the outcomes a driver acts on, as the email.
export function notifyDriverVerification(userId: string, status: string) {
  const notice = VERIFICATION_NOTICES[status];
  if (!notice) return Promise.resolve();

  return deliverNotification(userId, "driver.verification", notice);
}

// --- Wallet, payments and payouts

export function notifyWallet(
  userId: string,
  event: "topUp" | "topUpFailed",
  transaction: { id: string; amount: number; currency: string },
) {
  return deliverNotification(userId, `wallet.${event}` as const, () => {
    const amount = money(transaction.amount, transaction.currency);
    const data = { transactionId: transaction.id };
    return event === "topUp"
      ? { title: "Wallet topped up", body: `${amount} was added to your wallet.`, data }
      : {
          title: "Top-up didn't go through",
          body: `Your top-up of ${amount} couldn't be completed, so nothing was added to your wallet.`,
          data,
        };
  });
}

// Never the comment, and no trip id: which trip it was would tell who gave the rating.
export function notifyReview(userId: string, { rating, tip }: { rating: number; tip: number }) {
  return deliverNotification(userId, "review.received", () => ({
    title: tip > 0 ? "New review and tip" : "New review",
    body:
      `You got a ${rating}-star rating.` + (tip > 0 ? ` They also tipped you ${money(tip)}.` : ""),
  }));
}

// No label: where a driver's earnings go is the thing an account thief changes first.
export function notifyPayout(userId: string, action: "added" | "removed") {
  return deliverNotification(userId, "payout.methodChanged", {
    title: `Payout method ${action}`,
    body:
      (action === "added"
        ? "A payout method was added to your Nframa account. "
        : "A payout method was removed from your Nframa account. ") + NOT_YOU,
  });
}

export function notifyPaymentMethod(userId: string, status: "verified" | "failed") {
  return deliverNotification(
    userId,
    "paymentMethod.reviewed",
    status === "verified"
      ? {
          title: "Payment method verified",
          body: "Your payment method is verified and ready to use.",
        }
      : {
          title: "Payment method not verified",
          body: "We couldn't verify your payment method. Remove it and save it again with the correct details.",
        },
  );
}
