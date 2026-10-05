import db from "../../src/database/knex.js";
import type { Notification } from "../../src/models/notification.model.js";
import type { PushDevice } from "../../src/models/pushDevice.model.js";
import { trackForCleanup } from "./cleanup.js";
import { newExpoToken, newWebSubscription } from "./pushMock.js";

// The mock state and steering live in pushMock.ts (which setup.ts imports); this file adds what touches the DB.
export * from "./pushMock.js";

// Straight to the DB (no sign-in, no API) and tracked for cleanup. For web, token is the subscription endpoint.
export async function seedDevice(
  userId: string,
  platform: PushDevice["platform"],
  token?: string,
  overrides: { updatedAt?: Date } = {},
): Promise<PushDevice> {
  const subscription = platform === "web" ? newWebSubscription() : undefined;
  const [row] = await db("pushDevices")
    .insert({
      userId,
      platform,
      token: token ?? subscription?.endpoint ?? newExpoToken(),
      webKeys: subscription ? JSON.stringify(subscription.keys) : null,
      ...overrides,
    })
    .returning("*");
  trackForCleanup("pushDevices", { id: row.id });
  return row;
}

export async function seedNotification(
  userId: string,
  overrides: Partial<Omit<Notification, "id" | "userId">> = {},
): Promise<Notification> {
  const { data = {}, ...rest } = overrides;
  const [row] = await db("notifications")
    .insert({
      userId,
      type: "trip.accepted",
      title: "Trip accepted",
      body: "Your driver accepted your trip.",
      ...rest,
      data: JSON.stringify(data),
    })
    .returning("*");
  trackForCleanup("notifications", { id: row.id });
  return row;
}

// The user's inbox, newest first.
export function inboxOf(userId: string): Promise<Notification[]> {
  return db("notifications")
    .where({ userId })
    .orderBy([
      { column: "createdAt", order: "desc" },
      { column: "id", order: "desc" },
    ]);
}
