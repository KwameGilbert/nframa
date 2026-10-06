import { describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import type { Notification } from "../src/models/notification.model.js";
import { walletModel } from "../src/models/wallet.model.js";
import { notifyTrip } from "../src/services/notificationEvents.service.js";
import { flushNotifications } from "../src/services/notification.service.js";
import { today } from "../src/utils/tripTime.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin } from "./helpers/actors.js";
import { bookableCommute, bookingRider, insertTrip } from "./helpers/trips.js";
import { seedDevice, inboxOf } from "./helpers/push.js";

// Trip notification hooks: markArrived, completeTrip, cancelTrip, adminCancelTrip

const MINUTE = 60_000;
type Viewer = { token: string };
type Point = { lat: number; lng: number };

const pickupOf = (trip: { pickupLat: number; pickupLng: number }): Point => ({
  lat: trip.pickupLat,
  lng: trip.pickupLng,
});

const north = (p: Point, meters: number): Point => ({
  lat: Number((p.lat + meters / 111_320).toFixed(6)),
  lng: p.lng,
});

function arrive(viewer: Viewer, id: string, at: Point) {
  return api.post(`/trips/${id}/arrived`).set(auth(viewer.token)).send(at);
}

function complete(viewer: Viewer, id: string) {
  return api.post(`/trips/${id}/complete`).set(auth(viewer.token));
}

function cancel(viewer: Viewer, id: string, body?: object) {
  const req = api.post(`/trips/${id}/cancel`).set(auth(viewer.token));
  return body ? req.send(body) : req;
}

function adminCancel(token: string, id: string, body?: object) {
  const req = api.post(`/admin/trips/${id}/cancel`).set(auth(token));
  return body ? req.send(body) : req;
}

// An accepted trip on today's run, from the commute's start, its total held in the rider's wallet
async function acceptedToday(
  commute: Awaited<ReturnType<typeof bookableCommute>>["commute"],
  riderUserId: string,
  pickupIn = -MINUTE,
) {
  const scheduledPickupAt = new Date(Date.now() + pickupIn);
  const trip = await insertTrip(commute, riderUserId, {
    tripDate: today(),
    status: "accepted",
    acceptedAt: new Date(),
    expiresAt: null,
    scheduledPickupAt,
    scheduledDropoffAt: new Date(scheduledPickupAt.getTime() + 18 * MINUTE),
    heldAmount: 30.04,
  });
  if (trip.heldAmount > 0) {
    await db.transaction((trx) => walletModel.hold(trx, riderUserId, trip.heldAmount));
  }
  return trip;
}

describe("Trip notification hooks (pushTrips)", () => {
  describe("POST /trips/:id/arrived — markArrived notifies rider", () => {
    it("sends driverArrived push to rider (no inbox)", async () => {
      const { driver, commute } = await bookableCommute();
      const rider = await bookingRider(200);
      const trip = await acceptedToday(commute, rider.userId);
      await seedDevice(rider.userId, "ios");

      const res = await arrive(driver, trip.id, north(pickupOf(trip), 10));
      expectStatus(res, 200);
      await flushNotifications();

      const calls = vi.mocked(notifyTrip).mock.calls;
      expect(calls).toContainEqual([
        rider.userId,
        "driverArrived",
        expect.objectContaining({ id: trip.id }),
      ]);

      // driverArrived has inbox: false
      const inbox = await inboxOf(rider.userId);
      expect(inbox as Notification[]).toHaveLength(0);
    });
  });

  describe("POST /trips/:id/complete — completeTrip notifies both users", () => {
    it("sends completed push and inbox to both rider and driver", async () => {
      const { driver, commute } = await bookableCommute();
      const rider = await bookingRider(200);
      const trip = await acceptedToday(commute, rider.userId, 10 * MINUTE);
      await db("trips").where({ id: trip.id }).update({ status: "boarded", boardedAt: new Date() });
      await seedDevice(rider.userId, "ios");
      await seedDevice(driver.userId, "ios");

      const res = await complete(driver, trip.id);
      expectStatus(res, 200);
      await flushNotifications();

      const calls = vi.mocked(notifyTrip).mock.calls;
      expect(calls).toContainEqual([
        rider.userId,
        "completed",
        expect.objectContaining({ id: trip.id }),
      ]);
      expect(calls).toContainEqual([
        driver.userId,
        "completed",
        expect.objectContaining({ id: trip.id }),
      ]);

      // Both should have inbox notifications
      const riderInbox = await inboxOf(rider.userId);
      const driverInbox = await inboxOf(driver.userId);
      expect((riderInbox as Notification[]).some((n: Notification) => n.type === "trip.completed")).toBe(true);
      expect((driverInbox as Notification[]).some((n: Notification) => n.type === "trip.completed")).toBe(true);
    });
  });

  describe("POST /trips/:id/cancel — cancelTrip notifies other user", () => {
    it("sends cancelled push when rider cancels", async () => {
      const { driver, commute } = await bookableCommute();
      const rider = await bookingRider(200);
      const trip = await acceptedToday(commute, rider.userId);
      await seedDevice(driver.userId, "ios");

      const res = await cancel(rider, trip.id, { reason: "Changed my mind" });
      expectStatus(res, 200);
      await flushNotifications();

      const calls = vi.mocked(notifyTrip).mock.calls;
      expect(calls).toContainEqual([
        driver.userId,
        "cancelled",
        expect.objectContaining({ id: trip.id }),
        "rider",
      ]);

      // cancelled has inbox: true
      const driverInbox = await inboxOf(driver.userId);
      expect((driverInbox as Notification[]).some((n: Notification) => n.type === "trip.cancelled")).toBe(true);
    });

    it("sends cancelled push when driver cancels", async () => {
      const { driver, commute } = await bookableCommute();
      const rider = await bookingRider(200);
      const trip = await acceptedToday(commute, rider.userId);
      await seedDevice(rider.userId, "ios");

      const res = await cancel(driver, trip.id, { reason: "Mechanical issue" });
      expectStatus(res, 200);
      await flushNotifications();

      const calls = vi.mocked(notifyTrip).mock.calls;
      expect(calls).toContainEqual([
        rider.userId,
        "cancelled",
        expect.objectContaining({ id: trip.id }),
        "driver",
      ]);

      // cancelled has inbox: true
      const riderInbox = await inboxOf(rider.userId);
      expect((riderInbox as Notification[]).some((n: Notification) => n.type === "trip.cancelled")).toBe(true);
    });
  });

  describe("POST /admin/trips/:id/cancel — adminCancelTrip notifies both", () => {
    it("sends cancelled push to both with admin cancellation", async () => {
      const superAdmin = await loginAsSuperAdmin();
      const tripAdmin = await createSignedInAdmin(superAdmin.token, {
        trips: { read: true, delete: true },
      });
      const { driver, commute } = await bookableCommute();
      const rider = await bookingRider(200);
      const trip = await acceptedToday(commute, rider.userId);
      await seedDevice(rider.userId, "ios");
      await seedDevice(driver.userId, "ios");

      const res = await adminCancel(tripAdmin.token, trip.id, { reason: "Admin override" });
      expectStatus(res, 200);
      await flushNotifications();

      const calls = vi.mocked(notifyTrip).mock.calls;
      expect(calls).toContainEqual([
        rider.userId,
        "cancelled",
        expect.objectContaining({ id: trip.id }),
        "admin",
      ]);
      expect(calls).toContainEqual([
        driver.userId,
        "cancelled",
        expect.objectContaining({ id: trip.id }),
        "admin",
      ]);

      // Both should have inbox notifications
      const riderInbox = await inboxOf(rider.userId);
      const driverInbox = await inboxOf(driver.userId);
      expect((riderInbox as Notification[]).some((n: Notification) => n.type === "trip.cancelled")).toBe(true);
      expect((driverInbox as Notification[]).some((n: Notification) => n.type === "trip.cancelled")).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("handles missing trip 404 gracefully", async () => {
      const { driver } = await bookableCommute();
      const unknownId = "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60";

      const res = await arrive(driver, unknownId, { lat: 5.6, lng: -0.2 });
      expectError(res, 404, `Trip not found: ${unknownId}`);

      // No notify call should happen
      const calls = vi.mocked(notifyTrip).mock.calls;
      expect(calls.some((call) => call[2]?.id === unknownId)).toBe(false);
    });
  });
});
