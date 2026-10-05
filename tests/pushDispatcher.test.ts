import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { PRIVATE_PUSH } from "../src/config/notificationTypes.js";
import { notificationModel } from "../src/models/notification.model.js";
import { pushDeviceModel, type PushDevice } from "../src/models/pushDevice.model.js";
import { sendExpoPush } from "../src/services/expo.service.js";
import {
  deliverNotification,
  deliverToDesk,
  flushNotifications,
} from "../src/services/notification.service.js";
import {
  notifyAccount,
  notifyAdminAccess,
  notifyDriverVerification,
  notifyPaymentMethod,
  notifyPayout,
  notifyReport,
  notifyReview,
  notifySos,
  notifyTrip,
  notifyWallet,
  type TripNoticeEvent,
} from "../src/services/notificationEvents.service.js";
import * as pushReceipts from "../src/services/pushReceipts.service.js";
import { emitToUser } from "../src/services/socket.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createPhoneAccount,
  createRole,
  loginAsSuperAdmin,
} from "./helpers/actors.js";
import {
  expoPushesTo,
  forceExpo,
  forceWeb,
  inboxOf,
  newExpoToken,
  seedDevice,
  seedNotification,
  webPushesTo,
} from "./helpers/push.js";

// The dispatcher on its own (no routes): what lands in the inbox, the socket event and each provider. Every
// assertion is filtered by this test's own user, token or id, so other tests (and other files) never interfere.

const DAY = 24 * 60 * 60 * 1000;

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;

const enqueueReceipts = vi.spyOn(pushReceipts, "enqueueExpoReceipts");

const newUser = () => createPhoneAccount(superAdmin.token, "rider");

const accepted = (tripId = randomUUID()) => ({
  title: "Trip accepted",
  body: "Your driver accepted your trip for Mon 5 Oct, 07:30.",
  data: { tripId },
});

const devicesOf = (userId: string): Promise<PushDevice[]> =>
  db("pushDevices").where({ userId }).orderBy("createdAt");

const inboxEvents = (userId: string) =>
  vi
    .mocked(emitToUser)
    .mock.calls.filter(([to, event]) => to === userId && event === "notification:new");

const dataOf = (message: Record<string, unknown>) => message.data as Record<string, string>;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
});

describe("deliverNotification", () => {
  it("writes the inbox row, emits notification:new and pushes to ios, android and web", async () => {
    const user = await newUser();
    const [ios, android, web] = await Promise.all([
      seedDevice(user.id, "ios"),
      seedDevice(user.id, "android"),
      seedDevice(user.id, "web"),
    ]);
    const content = accepted();

    await deliverNotification(user.id, "trip.accepted", content);

    const inbox = await inboxOf(user.id);
    expect(inbox).toEqual([
      expect.objectContaining({ ...content, type: "trip.accepted", readAt: null }),
    ]);
    expect(inboxEvents(user.id)).toEqual([
      [
        user.id,
        "notification:new",
        {
          // Exactly the client view: no userId.
          notification: {
            id: inbox[0].id,
            type: "trip.accepted",
            ...content,
            readAt: null,
            createdAt: expect.any(Date),
          },
          unreadCount: 1,
        },
      ],
    ]);

    const shown = {
      title: content.title,
      body: content.body,
      data: { ...content.data, type: "trip.accepted", notificationId: inbox[0].id },
    };
    for (const device of [ios, android]) {
      expect(expoPushesTo(device.token)).toEqual([
        {
          to: device.token,
          ...shown,
          channelId: "trips",
          priority: "high",
          ttl: 6 * 60 * 60,
          sound: "default",
          badge: 1,
        },
      ]);
    }
    expect(webPushesTo(web.token)).toEqual([
      {
        subscription: { endpoint: web.token, keys: web.webKeys },
        payload: shown,
        options: { urgency: "high", ttl: 6 * 60 * 60 },
      },
    ]);
  });

  it("sets the badge to the unread count only when an inbox row was written", async () => {
    const user = await newUser();
    const [ios] = await Promise.all([seedDevice(user.id, "ios"), seedNotification(user.id)]);
    const tripId = randomUUID();

    await deliverNotification(user.id, "trip.completed", {
      title: "Trip complete",
      body: "Thanks for riding with Nframa. Tap to rate your driver.",
      data: { tripId },
    });
    await deliverNotification(user.id, "trip.driverArrived", {
      title: "Your driver has arrived",
      body: "Your driver is at the pickup point. Open the app to show your boarding code.",
      data: { tripId },
    });

    const [completed, arrived] = expoPushesTo(ios.token);
    expect(completed.badge).toBe(2);
    expect(arrived).not.toHaveProperty("badge");
    expect(dataOf(arrived)).toEqual({ tripId, type: "trip.driverArrived" });
    expect(arrived.ttl).toBe(10 * 60);
    expect((await inboxOf(user.id)).map((row) => row.type)).toEqual([
      "trip.completed",
      "trip.accepted",
    ]);
    expect(inboxEvents(user.id)).toHaveLength(1);
  });

  it("sends nothing to a deleted account or an unknown user", async () => {
    const user = await newUser();
    const ios = await seedDevice(user.id, "ios");
    await db("users").where({ id: user.id }).update({ deletedAt: new Date() });

    await deliverNotification(user.id, "trip.accepted", accepted());
    await expect(
      deliverNotification(randomUUID(), "trip.accepted", accepted()),
    ).resolves.toBeUndefined();

    expect(await inboxOf(user.id)).toEqual([]);
    expect(expoPushesTo(ios.token)).toEqual([]);
    expect(inboxEvents(user.id)).toEqual([]);
  });

  it("skips a suspended account, but delivers the suspension notice to the devices just removed", async () => {
    const user = await newUser();
    const [ios, web] = await Promise.all([seedDevice(user.id, "ios"), seedDevice(user.id, "web")]);
    await db("users").where({ id: user.id }).update({ status: "suspended" });

    await deliverNotification(user.id, "trip.accepted", accepted());
    const removed = await pushDeviceModel.removeAllForUser(user.id);
    // A device override alone doesn't get past the suspension.
    await deliverNotification(user.id, "trip.accepted", accepted(), { devices: removed });
    expect(expoPushesTo(ios.token)).toEqual([]);
    expect(await inboxOf(user.id)).toEqual([]);

    await notifyAccount(user.id, "suspended", { devices: removed });

    const [notice] = await inboxOf(user.id);
    expect(notice).toMatchObject({ type: "account.suspended", title: "Account suspended" });
    expect(expoPushesTo(ios.token)).toEqual([
      expect.objectContaining({
        title: "Account suspended",
        channelId: "account",
        data: { type: "account.suspended", notificationId: notice.id },
      }),
    ]);
    expect(webPushesTo(web.token)).toHaveLength(1);
    expect(await devicesOf(user.id)).toEqual([]);
  });

  it("never rejects when the builder throws, and sends nothing", async () => {
    const user = await newUser();
    const ios = await seedDevice(user.id, "ios");

    await expect(
      deliverNotification(user.id, "trip.accepted", () => {
        throw new Error("Builder failed");
      }),
    ).resolves.toBeUndefined();

    expect(expoPushesTo(ios.token)).toEqual([]);
    expect(await inboxOf(user.id)).toEqual([]);
  });

  it("still writes the inbox and reaches the other devices when a provider call throws", async () => {
    const user = await newUser();
    const [ios, brokenWeb, web] = await Promise.all([
      seedDevice(user.id, "ios"),
      seedDevice(user.id, "web"),
      seedDevice(user.id, "web"),
    ]);
    forceExpo(ios.token, "throw");
    forceWeb(brokenWeb.token, "throw");

    await expect(
      deliverNotification(user.id, "trip.accepted", accepted()),
    ).resolves.toBeUndefined();

    expect(await inboxOf(user.id)).toHaveLength(1);
    expect(webPushesTo(web.token)).toHaveLength(1);
    // Nothing is deleted for a failed call: only a provider saying the device is gone does that.
    expect(await devicesOf(user.id)).toHaveLength(3);
  });

  it("still pushes when the inbox write fails", async () => {
    const user = await newUser();
    const ios = await seedDevice(user.id, "ios");
    const original = notificationModel.create.bind(notificationModel);
    const create = vi
      .spyOn(notificationModel, "create")
      .mockImplementation((input, trx) =>
        input.userId === user.id
          ? Promise.reject(new Error("Inbox is down"))
          : original(input, trx),
      );

    try {
      await deliverNotification(user.id, "trip.accepted", accepted());
    } finally {
      create.mockRestore();
    }

    const [message] = expoPushesTo(ios.token);
    expect(message).not.toHaveProperty("badge");
    expect(dataOf(message)).not.toHaveProperty("notificationId");
    expect(inboxEvents(user.id)).toEqual([]);
  });

  it("deletes exactly the device whose ticket says DeviceNotRegistered", async () => {
    const user = await newUser();
    const [dead, limited, alive] = await Promise.all([
      seedDevice(user.id, "ios"),
      seedDevice(user.id, "android"),
      seedDevice(user.id, "android"),
    ]);
    forceExpo(dead.token, "DeviceNotRegistered");
    forceExpo(limited.token, "MessageRateExceeded");

    await deliverNotification(user.id, "trip.accepted", accepted());

    expect((await devicesOf(user.id)).map((device) => device.id).sort()).toEqual(
      [limited.id, alive.id].sort(),
    );
    expect(expoPushesTo(alive.token)).toHaveLength(1);
  });

  it("keeps a device whose ticket says InvalidCredentials: our provider setup is wrong, not the device", async () => {
    const user = await newUser();
    const ios = await seedDevice(user.id, "ios");
    forceExpo(ios.token, "InvalidCredentials");

    await expect(
      deliverNotification(user.id, "trip.accepted", accepted()),
    ).resolves.toBeUndefined();

    expect(expoPushesTo(ios.token)).toHaveLength(1);
    expect((await devicesOf(user.id)).map((device) => device.id)).toEqual([ios.id]);
    expect(
      enqueueReceipts.mock.calls
        .flatMap(([entries]) => entries)
        .filter((e) => e.token === ios.token),
    ).toEqual([]);
  });

  it("deletes a web subscription the push service says is gone (410) and keeps one that failed (500)", async () => {
    const user = await newUser();
    const [gone, failing] = await Promise.all([
      seedDevice(user.id, "web"),
      seedDevice(user.id, "web"),
    ]);
    forceWeb(gone.token, "gone");
    forceWeb(failing.token, "error");

    await deliverNotification(user.id, "trip.accepted", accepted());

    expect((await devicesOf(user.id)).map((device) => device.id)).toEqual([failing.id]);
  });

  it("never sends to a malformed Expo token, and deletes that device", async () => {
    const user = await newUser();
    const [bad, good] = await Promise.all([
      seedDevice(user.id, "android", `not-an-expo-token-${randomUUID()}`),
      seedDevice(user.id, "ios"),
    ]);

    await deliverNotification(user.id, "trip.accepted", accepted());

    expect(expoPushesTo(bad.token)).toEqual([]);
    expect(expoPushesTo(good.token)).toHaveLength(1);
    expect((await devicesOf(user.id)).map((device) => device.id)).toEqual([good.id]);
  });

  it("sends Expo messages in batches of at most 100, only this user's tokens in each", async () => {
    const user = await newUser();
    const now = new Date();
    const devices: PushDevice[] = Array.from({ length: 205 }, (_, i) => ({
      id: randomUUID(),
      userId: user.id,
      platform: i % 2 === 0 ? "ios" : "android",
      token: newExpoToken(),
      webKeys: null,
      createdAt: now,
      updatedAt: now,
    }));
    const tokens = new Set(devices.map((device) => device.token));

    await deliverNotification(user.id, "trip.driverArrived", accepted(), { devices });

    const batches = vi
      .mocked(sendExpoPush)
      .mock.calls.map(([messages]) => messages)
      .filter((messages) => messages.some((message) => tokens.has(message.to)));
    expect(batches.map((messages) => messages.length)).toEqual([100, 100, 5]);
    expect(batches.flat().every((message) => tokens.has(message.to))).toBe(true);
  });

  it("skips and deletes a device not seen for push.deviceStaleDays", async () => {
    const user = await newUser();
    const [stale, fresh] = await Promise.all([
      seedDevice(user.id, "ios", undefined, { updatedAt: new Date(Date.now() - 4000 * DAY) }),
      seedDevice(user.id, "android"),
    ]);

    await deliverNotification(user.id, "trip.accepted", accepted());

    expect(expoPushesTo(stale.token)).toEqual([]);
    expect(expoPushesTo(fresh.token)).toHaveLength(1);
    expect((await devicesOf(user.id)).map((device) => device.id)).toEqual([fresh.id]);
  });

  it("strips data keys that aren't allow-listed, from the push and the inbox", async () => {
    const user = await newUser();
    const [ios, web] = await Promise.all([seedDevice(user.id, "ios"), seedDevice(user.id, "web")]);
    const tripId = randomUUID();

    await deliverNotification(user.id, "trip.accepted", {
      ...accepted(tripId),
      data: {
        tripId,
        boardingCode: "TR-7KQ2MX",
        phoneNumber: "0241234567",
        type: "account.suspended",
        notificationId: "forged",
      } as never,
    });

    const [row] = await inboxOf(user.id);
    expect(row.data).toEqual({ tripId });
    const expected = { tripId, type: "trip.accepted", notificationId: row.id };
    expect(dataOf(expoPushesTo(ios.token)[0])).toEqual(expected);
    expect(dataOf(webPushesTo(web.token)[0].payload)).toEqual(expected);
  });

  it("pushes generic text for a private type while the inbox keeps the specific text", async () => {
    const user = await newUser();
    const [ios, web] = await Promise.all([seedDevice(user.id, "ios"), seedDevice(user.id, "web")]);
    const incidentId = randomUUID();
    const reportId = randomUUID();

    await notifySos(user.id, { id: incidentId, status: "servicesContacted" });
    await notifyReport(user.id, { id: reportId, status: "resolved" });

    const [report, sos] = await inboxOf(user.id);
    expect(sos).toMatchObject({
      type: "sos.statusChanged",
      title: "Emergency services contacted",
      body: "Our safety team has contacted emergency services about your SOS alert.",
      data: { incidentId, status: "servicesContacted" },
    });
    expect(report).toMatchObject({
      type: "report.statusChanged",
      title: "Your report was resolved",
      data: { reportId, status: "resolved" },
    });

    // The status stays in the inbox only: on the lock screen it would give the outcome away.
    const sosData = { incidentId, type: "sos.statusChanged", notificationId: sos.id };
    const reportData = { reportId, type: "report.statusChanged", notificationId: report.id };
    expect(expoPushesTo(ios.token)).toEqual([
      expect.objectContaining({ ...PRIVATE_PUSH, channelId: "safety", data: sosData }),
      expect.objectContaining({ ...PRIVATE_PUSH, channelId: "safety", data: reportData }),
    ]);
    expect(webPushesTo(web.token).map((call) => call.payload)).toEqual([
      { ...PRIVATE_PUSH, data: sosData },
      { ...PRIVATE_PUSH, data: reportData },
    ]);
  });

  it("prunes only this user's rows older than notifications.retentionDays", async () => {
    const [user, other] = await Promise.all([newUser(), newUser()]);
    const longAgo = new Date(Date.now() - 4000 * DAY); // past the setting's 3650-day maximum
    const [, recent, othersOld] = await Promise.all([
      seedNotification(user.id, { createdAt: longAgo }),
      seedNotification(user.id),
      seedNotification(other.id, { createdAt: longAgo }),
    ]);

    await deliverNotification(user.id, "trip.accepted", accepted());

    const inbox = await inboxOf(user.id);
    expect(inbox.map((row) => row.id).slice(1)).toEqual([recent.id]);
    expect(inbox).toHaveLength(2);
    expect((await inboxOf(other.id)).map((row) => row.id)).toEqual([othersOld.id]);
    // The count is taken after the prune.
    expect(inboxEvents(user.id)[0][2]).toMatchObject({ unreadCount: 2 });
  });

  it("flushNotifications waits for a delivery nobody awaited", async () => {
    const user = await newUser();
    const ios = await seedDevice(user.id, "ios");

    void deliverNotification(user.id, "trip.accepted", accepted());
    await flushNotifications();

    expect(await inboxOf(user.id)).toHaveLength(1);
    expect(expoPushesTo(ios.token)).toHaveLength(1);
  });

  it("hands every ok Expo ticket to the receipt queue, and nothing else", async () => {
    const user = await newUser();
    const [ok, dead, web] = await Promise.all([
      seedDevice(user.id, "ios"),
      seedDevice(user.id, "android"),
      seedDevice(user.id, "web"),
    ]);
    forceExpo(dead.token, "DeviceNotRegistered");
    const mine = new Set([ok.token, dead.token, web.token]);

    await deliverNotification(user.id, "trip.accepted", accepted());

    const queued = enqueueReceipts.mock.calls
      .flatMap(([entries]) => entries)
      .filter((entry) => mine.has(entry.token));
    expect(queued).toEqual([{ receiptId: expect.any(String), token: ok.token }]);
  });
});

describe("notificationEvents wording", () => {
  const trip = {
    id: randomUUID(),
    commuteId: randomUUID(),
    status: "pending",
    tripDate: "2026-10-05",
    scheduledPickupAt: new Date("2026-10-05T07:30:00Z"),
  };

  it("formats {when} as the trip date and UTC pickup time", async () => {
    const user = await newUser();

    await notifyTrip(user.id, "accepted", trip);
    await notifyTrip(user.id, "requested", { ...trip, status: "accepted" });
    await notifyTrip(user.id, "cancelled", trip, "rider");

    expect(
      (await inboxOf(user.id)).map(({ title, body, data }) => ({ title, body, data })),
    ).toEqual([
      {
        title: "Trip cancelled",
        body: "The rider cancelled the trip for Mon 5 Oct, 07:30.",
        data: { tripId: trip.id, commuteId: trip.commuteId, tripDate: trip.tripDate },
      },
      {
        title: "New booking",
        body: "A rider booked a seat on your commute for Mon 5 Oct, 07:30.",
        data: { tripId: trip.id, commuteId: trip.commuteId, tripDate: trip.tripDate },
      },
      {
        title: "Trip accepted",
        body: "Your driver accepted your trip for Mon 5 Oct, 07:30.",
        data: { tripId: trip.id, commuteId: trip.commuteId, tripDate: trip.tripDate },
      },
    ]);
  });

  it("sends nothing for the statuses that aren't notified", async () => {
    const user = await newUser();
    const ios = await seedDevice(user.id, "ios");

    await Promise.all([
      notifySos(user.id, { id: randomUUID(), status: "triggered" }),
      notifySos(user.id, { id: randomUUID(), status: "cancelledByUser" }),
      notifyReport(user.id, { id: randomUUID(), status: "open" }),
      notifyReport(user.id, { id: randomUUID(), status: "withdrawn" }),
      notifyDriverVerification(user.id, "pending"),
    ]);
    await flushNotifications();

    expect(expoPushesTo(ios.token)).toEqual([]);
    expect(await inboxOf(user.id)).toEqual([]);
  });

  it("never puts a code, phone number or boarding code in any payload or inbox row", async () => {
    const user = await newUser();
    const [ios, web] = await Promise.all([seedDevice(user.id, "ios"), seedDevice(user.id, "web")]);
    const events: TripNoticeEvent[] = [
      "requested",
      "accepted",
      "declined",
      "cancelled",
      "driverArrived",
      "completed",
      "noShow",
    ];

    await Promise.all([
      ...events.map((event) => notifyTrip(user.id, event, trip, "driver")),
      notifySos(user.id, { id: randomUUID(), status: "resolved" }),
      notifyReport(user.id, { id: randomUUID(), status: "dismissed" }),
      notifyAccount(user.id, "passwordChanged"),
      notifyAccount(user.id, "contactChanged"),
      notifyAccount(user.id, "reactivated"),
      notifyAdminAccess(user.id, "granted"),
      notifyDriverVerification(user.id, "rejected"),
      notifyWallet(user.id, "topUp", { id: randomUUID(), amount: 50, currency: "GHS" }),
      notifyWallet(user.id, "topUpFailed", { id: randomUUID(), amount: 20, currency: "GHS" }),
      notifyReview(user.id, { rating: 5, tip: 5 }),
      notifyPayout(user.id, "added"),
      notifyPaymentMethod(user.id, "failed"),
    ]);

    const inbox = await inboxOf(user.id);
    const everything = JSON.stringify([inbox, expoPushesTo(ios.token), webPushesTo(web.token)]);
    expect(inbox).toHaveLength(events.length - 1 + 12); // driverArrived has no inbox row
    expect(expoPushesTo(ios.token)).toHaveLength(events.length + 12);
    expect(everything).not.toMatch(/TR-|DR-|boardingCode|phoneNumber/);
    expect(everything).not.toContain(user.phoneNumber);
    expect(inbox.map((row) => row.body)).toEqual(
      expect.arrayContaining([
        "GHS 50.00 was added to your wallet.",
        "You got a 5-star rating. They also tipped you GHS 5.00.",
      ]),
    );
  });
});

describe("deliverToDesk", () => {
  it("pushes only to active admins whose role can read the module, with no inbox row or socket event", async () => {
    const [deskRole, otherRole] = await Promise.all([
      createRole(superAdmin.token, { sos: { read: true } }),
      createRole(superAdmin.token, { users: { read: true } }),
    ]);
    const [reader, unreachable, suspended, deactivated, outsider] = await Promise.all([
      createAdminAccount(superAdmin.token, { roleId: deskRole.id }),
      createAdminAccount(superAdmin.token, { roleId: deskRole.id }),
      createAdminAccount(superAdmin.token, { roleId: deskRole.id, status: "suspended" }),
      createAdminAccount(superAdmin.token, { roleId: deskRole.id }),
      createAdminAccount(superAdmin.token, { roleId: otherRole.id }),
    ]);
    await db("users").where({ id: deactivated.userId }).update({ status: "suspended" });
    const [readerDevice, unreachableDevice, ...others] = await Promise.all(
      [reader, unreachable, suspended, deactivated, outsider].map((admin) =>
        seedDevice(admin.userId, "ios"),
      ),
    );
    // One admin's provider call failing doesn't stop another admin's push.
    forceExpo(unreachableDevice.token, "throw");
    const incidentId = randomUUID();

    await expect(
      deliverToDesk("sos", "sos.deskAlert", {
        title: "New SOS alert",
        body: "An SOS alert needs attention. Open the safety desk.",
        data: { incidentId },
      }),
    ).resolves.toBeUndefined();

    // Other files raise desk alerts too, so only this alert's pushes count.
    const alerts = (device: PushDevice) =>
      expoPushesTo(device.token).filter((message) => dataOf(message).incidentId === incidentId);
    expect(alerts(readerDevice)).toEqual([
      expect.objectContaining({
        title: "New SOS alert",
        channelId: "safety",
        data: { incidentId, type: "sos.deskAlert" },
      }),
    ]);
    expect(alerts(readerDevice)[0]).not.toHaveProperty("badge");
    for (const device of others) expect(alerts(device)).toEqual([]);

    // Each admin's devices go in their own Expo call.
    const call = vi
      .mocked(sendExpoPush)
      .mock.calls.find(([messages]) => messages.some((m) => m.to === readerDevice.token));
    expect(call?.[0].map((message) => message.to)).toEqual([readerDevice.token]);

    expect(await inboxOf(reader.userId)).toEqual([]);
    expect(inboxEvents(reader.userId)).toEqual([]);
  });

  it("follows a role edit on the very next alert", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });
    const admin = await createAdminAccount(superAdmin.token, { roleId: role.id });
    const device = await seedDevice(admin.userId, "android");
    const alert = (reportId: string) =>
      deliverToDesk("reports", "report.deskUrgent", {
        title: "New urgent report",
        body: "An urgent trip report was filed. Open the reports queue.",
        data: { reportId },
      });
    const reached = (reportId: string) =>
      expoPushesTo(device.token).filter((message) => dataOf(message).reportId === reportId);
    const [before, granted, revoked] = [randomUUID(), randomUUID(), randomUUID()];

    await alert(before);
    const grant = await api
      .put(`/roles/${role.id}/permissions/reports`)
      .set(auth(superAdmin.token))
      .send({ read: true });
    expectStatus(grant, 200);
    await alert(granted);
    const revoke = await api
      .delete(`/roles/${role.id}/permissions/reports`)
      .set(auth(superAdmin.token));
    expectStatus(revoke, 200);
    await alert(revoked);

    expect(reached(before)).toEqual([]);
    expect(reached(granted)).toHaveLength(1);
    expect(reached(revoked)).toEqual([]);
  });
});
