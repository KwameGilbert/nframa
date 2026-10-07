// What each notification is: which Android channel it uses, how urgent it is, how long a provider keeps trying to
// deliver it (seconds), whether it also lands in the user's inbox, and whether its lock-screen text is generic.
export type AndroidChannel = "trips" | "safety" | "account" | "wallet";

export interface NotificationTypeSpec {
  channel: AndroidChannel;
  priority: "high" | "normal";
  ttl: number;
  inbox: boolean;
  // "private": the push shows PRIVATE_PUSH, the specific text lives only in the inbox row.
  lockScreen: "full" | "private";
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const NOTIFICATION_TYPES = {
  "trip.requested": {
    channel: "trips",
    priority: "high",
    ttl: 30 * MINUTE,
    inbox: true,
    lockScreen: "full",
  },
  "trip.accepted": {
    channel: "trips",
    priority: "high",
    ttl: 6 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "trip.declined": {
    channel: "trips",
    priority: "high",
    ttl: 6 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "trip.cancelled": {
    channel: "trips",
    priority: "high",
    ttl: 6 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "trip.driverArrived": {
    channel: "trips",
    priority: "high",
    ttl: 10 * MINUTE,
    inbox: false,
    lockScreen: "full",
  },
  "trip.completed": {
    channel: "trips",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "trip.noShow": {
    channel: "trips",
    priority: "normal",
    ttl: 6 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "sos.deskAlert": {
    channel: "safety",
    priority: "high",
    ttl: HOUR,
    inbox: false,
    lockScreen: "full",
  },
  "sos.statusChanged": {
    channel: "safety",
    priority: "high",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "private",
  },
  "report.created": {
    channel: "safety",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "report.deskUrgent": {
    channel: "safety",
    priority: "high",
    ttl: HOUR,
    inbox: false,
    lockScreen: "full",
  },
  "report.statusChanged": {
    channel: "safety",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "private",
  },
  "driver.verification": {
    channel: "account",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "account.suspended": {
    channel: "account",
    priority: "high",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "account.reactivated": {
    channel: "account",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "account.passwordChanged": {
    channel: "account",
    priority: "high",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "account.contactChanged": {
    channel: "account",
    priority: "high",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "account.adminAccess": {
    channel: "account",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "wallet.topUp": {
    channel: "wallet",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "wallet.topUpFailed": {
    channel: "wallet",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "review.received": {
    channel: "account",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "payout.methodChanged": {
    channel: "account",
    priority: "high",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "paymentMethod.reviewed": {
    channel: "wallet",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  // Support: never the subject, a message, the code or a name, only that something happened.
  "support.reply": {
    channel: "account",
    priority: "high",
    ttl: 24 * HOUR,
    inbox: false,
    lockScreen: "full",
  },
  "support.statusChanged": {
    channel: "account",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "support.openedForYou": {
    channel: "account",
    priority: "normal",
    ttl: 24 * HOUR,
    inbox: true,
    lockScreen: "full",
  },
  "support.assigned": {
    channel: "account",
    priority: "normal",
    ttl: 6 * HOUR,
    inbox: false,
    lockScreen: "full",
  },
  "support.userReplied": {
    channel: "account",
    priority: "normal",
    ttl: 6 * HOUR,
    inbox: false,
    lockScreen: "full",
  },
  "support.deskAlert": {
    channel: "account",
    priority: "high",
    ttl: HOUR,
    inbox: false,
    lockScreen: "full",
  },
} as const satisfies Record<string, NotificationTypeSpec>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

// The only keys a push payload's data may carry (plus type and notificationId, added by the dispatcher). Ids only:
// payloads travel through Expo, APNs and FCM in plaintext.
export const PUSH_DATA_KEYS = [
  "tripId",
  "commuteId",
  "tripDate",
  "incidentId",
  "reportId",
  "transactionId",
  "ticketId",
  "status",
] as const;

export type PushDataKey = (typeof PUSH_DATA_KEYS)[number];

// Lock-screen text for the types marked lockScreen: "private".
export const PRIVATE_PUSH = {
  title: "Nframa",
  body: "You have a new update. Open the app to view it.",
} as const;

export const MAX_DEVICES_PER_USER = 10;

// A web-push subscription's endpoint must be on one of these hosts, so a client can't make the server call an
// arbitrary URL.
export const WEB_PUSH_HOSTS = {
  exact: ["fcm.googleapis.com"],
  suffixes: [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"],
} as const;

export function isAllowedWebPushHost(host: string): boolean {
  return (
    (WEB_PUSH_HOSTS.exact as readonly string[]).includes(host) ||
    WEB_PUSH_HOSTS.suffixes.some((suffix) => host.endsWith(suffix))
  );
}
