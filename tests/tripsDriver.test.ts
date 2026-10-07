import { describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { tripModel } from "../src/models/trip.model.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { addDays, today } from "../src/utils/tripTime.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, fullPhone, loginAsSuperAdmin } from "./helpers/actors.js";
import {
  addCommute,
  along,
  bookableCommute,
  bookingRider,
  expectHoldsMatchTrips,
  insertTrip,
  requestTrip,
  tomorrow,
  walletOf,
  type TestCommute,
} from "./helpers/trips.js";

// The driver's side of trips: accepting and declining requests, the manifest, and the commute edit guard. Kept
// apart from trips.test.ts and tripDetails.test.ts because each file can sign up only about 45 accounts.

type Viewer = { token: string };

function accept(viewer: Viewer, id: string) {
  return api.post(`/trips/${id}/accept`).set(auth(viewer.token));
}

function decline(viewer: Viewer, id: string, body?: object) {
  const req = api.post(`/trips/${id}/decline`).set(auth(viewer.token));
  return body ? req.send(body) : req;
}

function cancel(viewer: Viewer, id: string) {
  return api.post(`/trips/${id}/cancel`).set(auth(viewer.token));
}

function manifest(viewer: Viewer, commuteId: string, query: Record<string, unknown> = {}) {
  return api.get(`/commutes/${commuteId}/trips`).set(auth(viewer.token)).query(query);
}

function editCommute(viewer: Viewer, commuteId: string, body: object) {
  return api.patch(`/commutes/${commuteId}`).set(auth(viewer.token)).send(body);
}

async function requested(rider: Viewer, commute: TestCommute, body = {}) {
  const res = await requestTrip(rider, commute, body);
  expectStatus(res, 201);
  expect(res.body.data.status).toBe("pending");
  return res.body.data as { id: string; totalAmount: number; boardingCode: string };
}

const statusOf = async (id: string) => (await tripModel.findById(id))?.status;

describe("POST /trips/:id/accept", () => {
  it("gives the rider the seat and holds the total, and tells the rider", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    const trip = await requested(rider, commute);

    const res = await accept(driver, trip.id);
    expectStatus(res, 200);
    expect(res.body.message).toBe("Trip accepted successfully");
    expect(res.body.data).toMatchObject({
      id: trip.id,
      status: "accepted",
      heldAmount: trip.totalAmount,
      expiresAt: null,
      boardingCode: null,
      rider: { fullName: rider.fullName, phone: fullPhone(rider) },
      seatsLeft: 2,
    });
    expect(res.body.data.acceptedAt).not.toBeNull();
    expect(JSON.stringify(res.body.data)).not.toContain(trip.boardingCode);
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: trip.totalAmount });
    await expectHoldsMatchTrips(rider.userId);

    // Now confirmed, the rider has the driver's phone, and still their own code.
    const riderView = await api.get(`/trips/${trip.id}`).set(auth(rider.token));
    expect(riderView.body.data).toMatchObject({
      boardingCode: trip.boardingCode,
      driver: { phone: fullPhone(driver) },
      rider: { phone: null },
    });

    expectError(await accept(driver, trip.id), 409, "Can't accept a trip that is accepted");
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: trip.totalAmount });
  });

  it("lets only the trip's driver accept it", async () => {
    const [{ driver, commute }, { driver: otherDriver }, rider, superAdmin] = await Promise.all([
      bookableCommute(),
      bookableCommute(),
      bookingRider(200),
      loginAsSuperAdmin(),
    ]);
    const trip = await requested(rider, commute);

    for (const caller of [otherDriver, rider, superAdmin]) {
      expectError(await accept(caller, trip.id), 403, "Only the trip's driver can accept it");
    }
    const unknown = "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60";
    expectError(await accept(driver, unknown), 404, `Trip not found: ${unknown}`);
    expectError(await accept(driver, "not-a-uuid"), 400, "id: Invalid UUID");

    expect(await statusOf(trip.id)).toBe("pending");
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });
  });

  it("refuses trips that aren't pending, expired requests, paused commutes and riders who can't pay", async () => {
    const { driver, commute } = await bookableCommute();
    const paused = await addCommute(driver);
    const rider = await bookingRider(10);
    const day = (n: number) => addDays(tomorrow(), n);
    const [cancelled, declined, expired, tooDear, onPaused] = await Promise.all([
      insertTrip(commute, rider.userId, { tripDate: day(0), status: "cancelled" }),
      insertTrip(commute, rider.userId, { tripDate: day(1), status: "declined" }),
      insertTrip(commute, rider.userId, {
        tripDate: day(2),
        expiresAt: new Date(Date.now() - 1000),
      }),
      insertTrip(commute, rider.userId, { tripDate: day(3) }),
      insertTrip(paused, rider.userId, { tripDate: day(0), totalAmount: 5 }),
    ]);
    expectStatus(await editCommute(driver, paused.id, { isActive: false }), 200);

    expectError(await accept(driver, cancelled.id), 409, "Can't accept a trip that is cancelled");
    expectError(await accept(driver, declined.id), 409, "Can't accept a trip that is declined");
    expectError(await accept(driver, expired.id), 409, "Can't accept a trip that is expired");
    expect(await statusOf(expired.id)).toBe("expired");
    expectError(await accept(driver, onPaused.id), 409, "This commute is not taking bookings");
    expectError(
      await accept(driver, tooDear.id),
      409,
      "The rider's wallet no longer covers this trip",
    );

    expect(await statusOf(tooDear.id)).toBe("pending");
    expect(await statusOf(onPaused.id)).toBe("pending");
    expect(await walletOf(rider.userId)).toEqual({ balance: 10, heldAmount: 0 });
    expect(await tripModel.seatsLeft(commute.id, day(3))).toBe(3);
    await expectHoldsMatchTrips(rider.userId);
  });

  it("refuses a driver who is no longer approved or whose account was deleted", async () => {
    const [{ driver, commute }, { driver: auto, commute: autoCommute }] = await Promise.all([
      bookableCommute(),
      bookableCommute({ autoAccept: true }),
    ]);
    const rider = await bookingRider(200);
    const first = await requested(rider, commute);
    const second = await requested(rider, commute, { tripDate: addDays(tomorrow(), 1) });

    await db("carOwnerProfiles")
      .where({ userId: driver.userId })
      .update({ verificationStatus: "rejected" });
    expectError(await accept(driver, first.id), 409, "This commute is not taking bookings");

    await db("carOwnerProfiles")
      .where({ userId: driver.userId })
      .update({ verificationStatus: "approved" });
    await db("users").where({ id: driver.userId }).update({ deletedAt: new Date() });
    expectError(await accept(driver, second.id), 409, "This commute is not taking bookings");

    await db("carOwnerProfiles")
      .where({ userId: auto.userId })
      .update({ verificationStatus: "rejected" });
    expectError(
      await requestTrip(rider, autoCommute, { tripDate: addDays(tomorrow(), 2) }),
      409,
      "This commute is not taking bookings",
    );

    expect(await statusOf(first.id)).toBe("pending");
    expect(await statusOf(second.id)).toBe("pending");
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });
    await expectHoldsMatchTrips(rider.userId);
  });

  it("gives the last seat to exactly one of two simultaneous accepts", async () => {
    const { driver, commute } = await bookableCommute({ capacity: 1 });
    const riders = await Promise.all([bookingRider(100), bookingRider(100)]);
    const trips = await Promise.all(riders.map((rider) => requested(rider, commute)));

    const results = await Promise.all(trips.map((trip) => accept(driver, trip.id)));

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.status === 409)?.body.error).toBe("This commute is full");
    expect(await tripModel.seatsLeft(commute.id, tomorrow())).toBe(0);
    expect((await Promise.all(trips.map((trip) => statusOf(trip.id)))).sort()).toEqual([
      "accepted",
      "pending",
    ]);
    for (const rider of riders) await expectHoldsMatchTrips(rider.userId);
  });

  it("holds the money once when the same request is accepted twice at once", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(100);
    const trip = await requested(rider, commute);

    const results = await Promise.all([accept(driver, trip.id), accept(driver, trip.id)]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.status === 409)?.body.error).toBe(
      "Can't accept a trip that is accepted",
    );
    expect(await walletOf(rider.userId)).toEqual({ balance: 100, heldAmount: trip.totalAmount });
    expect(await tripModel.seatsLeft(commute.id, tomorrow())).toBe(2);
    await expectHoldsMatchTrips(rider.userId);
  });

  it("ends consistently when the driver accepts while the rider cancels", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(300);
    const dates = [1, 2, 3].map((n) => addDays(today(), n));
    const trips = [];
    for (const tripDate of dates) trips.push(await requested(rider, commute, { tripDate }));

    const results = await Promise.all(
      trips.map((trip) => Promise.all([accept(driver, trip.id), cancel(rider, trip.id)])),
    );

    for (const [accepted, cancelled] of results) {
      // The rider can cancel either way; the accept either came first or finds the trip cancelled.
      expectStatus(cancelled, 200);
      if (accepted.status !== 200) {
        expectError(accepted, 409, "Can't accept a trip that is cancelled");
      }
    }
    for (const trip of trips) {
      expect(await tripModel.findById(trip.id)).toMatchObject({
        status: "cancelled",
        heldAmount: 0,
      });
    }
    for (const tripDate of dates) expect(await tripModel.seatsLeft(commute.id, tripDate)).toBe(3);
    expect(await walletOf(rider.userId)).toEqual({ balance: 300, heldAmount: 0 });
    await expectHoldsMatchTrips(rider.userId);
  });
});

describe("POST /trips/:id/decline", () => {
  it("declines a pending request without moving money, and only a pending one", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    const trip = await requested(rider, commute);

    expectError(await decline(rider, trip.id), 403, "Only the trip's driver can decline it");

    const res = await decline(driver, trip.id, { reason: "Car is full of family today" });
    expectStatus(res, 200);
    expect(res.body.message).toBe("Trip declined successfully");
    expect(res.body.data).toMatchObject({
      status: "declined",
      cancelledBy: "driver",
      cancellationReason: "Car is full of family today",
      heldAmount: 0,
      expiresAt: null,
      boardingCode: null,
      rider: { phone: null },
      seatsLeft: 3,
    });
    expect(res.body.data.cancelledAt).not.toBeNull();
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });

    expectError(await decline(driver, trip.id), 409, "Can't decline a trip that is declined");
    expectError(await accept(driver, trip.id), 409, "Can't accept a trip that is declined");

    // A declined request doesn't block asking again; an accepted trip is cancelled, not declined.
    const again = await requested(rider, commute);
    expectStatus(await accept(driver, again.id), 200);
    expectError(await decline(driver, again.id), 409, "Can't decline a trip that is accepted");
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: again.totalAmount });
    await expectHoldsMatchTrips(rider.userId);
  });
});

describe("GET /commutes/:id/trips", () => {
  it("shows the driver every trip on a date, with phones only for confirmed seats", async () => {
    const [{ driver, commute }, { driver: otherDriver }, ama, kofi, efua, superAdmin] =
      await Promise.all([
        bookableCommute(),
        bookableCommute(),
        bookingRider(200),
        bookingRider(200),
        bookingRider(200),
        loginAsSuperAdmin(),
      ]);
    const admin = await createSignedInAdmin(superAdmin.token, { commutes: { read: true } });
    const amaTrip = await requested(ama, commute, {
      pickup: along(commute, 0.3),
      dropoff: along(commute, 0.9),
    });
    const kofiTrip = await requested(kofi, commute, {
      pickup: along(commute, 0.1),
      dropoff: along(commute, 0.5),
    });
    const efuaTrip = await requested(efua, commute, {
      pickup: along(commute, 0.2),
      dropoff: along(commute, 0.7),
    });
    expectStatus(await accept(driver, amaTrip.id), 200);
    expectStatus(await accept(driver, kofiTrip.id), 200);
    // Today's run is another date: only in the default (no date) view.
    const todays = await insertTrip(commute, efua.userId, { tripDate: today() });

    const res = await manifest(driver, commute.id, { date: tomorrow() });
    expectStatus(res, 200);
    const sheet = res.body.data;
    expect(sheet).toMatchObject({
      commuteId: commute.id,
      date: tomorrow(),
      departureAt: `${tomorrow()}T07:30:00.000Z`,
      capacity: 3,
      seatsLeft: 1,
      pagination: { page: 1, limit: 20, totalItems: 3, totalPages: 1 },
    });
    // Soonest pickup first.
    expect(sheet.items.map((item: { tripId: string }) => item.tripId)).toEqual([
      kofiTrip.id,
      efuaTrip.id,
      amaTrip.id,
    ]);
    expect(sheet.items[0]).toMatchObject({
      status: "accepted",
      tripDate: tomorrow(),
      rider: { id: kofi.userId, fullName: kofi.fullName, phone: fullPhone(kofi) },
      totalAmount: kofiTrip.totalAmount,
      heldAmount: kofiTrip.totalAmount,
    });
    expect(sheet.items[1]).toMatchObject({
      status: "pending",
      rider: { id: efua.userId, phone: null },
      heldAmount: 0,
    });
    // The route sheet: confirmed riders only, in route order, by first name.
    const first = (rider: { fullName: string }) => rider.fullName.split(" ")[0];
    expect(
      sheet.stops.map((s: { type: string; tripId: string; firstName: string }) => [
        s.type,
        s.tripId,
        s.firstName,
      ]),
    ).toEqual([
      ["pickup", kofiTrip.id, first(kofi)],
      ["pickup", amaTrip.id, first(ama)],
      ["dropoff", kofiTrip.id, first(kofi)],
      ["dropoff", amaTrip.id, first(ama)],
    ]);
    const body = JSON.stringify(sheet);
    for (const code of [amaTrip, kofiTrip, efuaTrip].map((trip) => trip.boardingCode)) {
      expect(body).not.toContain(code);
    }
    expect(body).not.toContain("boardingCode");

    const pending = await manifest(driver, commute.id, { date: tomorrow(), status: "pending" });
    expect(pending.body.data.items.map((item: { tripId: string }) => item.tripId)).toEqual([
      efuaTrip.id,
    ]);
    expect(pending.body.data.stops).toHaveLength(4);
    const page = await manifest(driver, commute.id, { date: tomorrow(), limit: 1, page: 2 });
    expect(page.body.data.items.map((item: { tripId: string }) => item.tripId)).toEqual([
      efuaTrip.id,
    ]);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 1, totalItems: 3, totalPages: 3 });

    const byDefault = await manifest(driver, commute.id);
    expect(byDefault.body.data).toMatchObject({ date: today(), seatsLeft: 3, stops: [] });
    expect(byDefault.body.data.items.map((item: { tripId: string }) => item.tripId)).toEqual([
      todays.id,
    ]);

    // An admin reads the manifest, but riders' phones are for the driver.
    const adminView = await manifest(admin, commute.id, { date: tomorrow() });
    expectStatus(adminView, 200);
    expect(adminView.body.data.pagination.totalItems).toBe(3);
    for (const item of adminView.body.data.items) expect(item.rider.phone).toBeNull();
    expect(JSON.stringify(adminView.body.data)).not.toContain(fullPhone(kofi));
    expectError(
      await manifest(otherDriver, commute.id),
      403,
      "Missing permission: read on commutes",
    );
    expectError(await manifest(ama, commute.id), 403, "Missing permission: read on commutes");
    const unknown = "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34";
    expectError(await manifest(driver, unknown), 404, `Commute not found: ${unknown}`);
    expectError(
      await manifest(driver, commute.id, { date: "2026-02-30" }),
      400,
      "date: Invalid ISO date",
    );
    for (const rider of [ama, kofi, efua]) await expectHoldsMatchTrips(rider.userId);
  });
});

describe("PATCH /commutes/:id with upcoming trips", () => {
  const GUARD =
    "This commute has upcoming trips: pause it or cancel them before changing its route or schedule";

  it("refuses to move the route or schedule, but allows everything else", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    await requested(rider, commute);

    for (const change of [
      { departureTime: "08:00" },
      { recurrenceDays: [1, 2, 3, 4, 5] },
      { startLat: 5.6301 },
      { endLng: -0.19 },
    ]) {
      expectError(await editCommute(driver, commute.id, change), 409, GUARD);
    }
    const unchanged = await api.get(`/commutes/${commute.id}`).set(auth(driver.token));
    expect(unchanged.body.data).toMatchObject({ departureTime: "07:30:00", startLat: 5.6224 });

    // The same values (a whole form resent, days in another order) aren't a change.
    const same = await editCommute(driver, commute.id, {
      departureTime: "07:30",
      recurrenceDays: [7, 6, 5, 4, 3, 2, 1],
      startLat: commute.startLat,
      startLng: commute.startLng,
      endLat: commute.endLat,
      endLng: commute.endLng,
    });
    expectStatus(same, 200);
    // Coordinates are stored to 6 decimals: extra digits that round to the same value aren't a change.
    expectStatus(
      await editCommute(driver, commute.id, {
        startLat: commute.startLat + 0.0000001,
        endLng: commute.endLng - 0.0000004,
      }),
      200,
    );

    const other = await editCommute(driver, commute.id, {
      startAddress: "Accra Mall main entrance, Tetteh Quarshie, Accra",
      capacity: 2,
      isActive: false,
    });
    expectStatus(other, 200);
    expect(other.body.data).toMatchObject({ capacity: 2, isActive: false });
    // Paused, the route still can't move while the trip stands.
    expectError(await editCommute(driver, commute.id, { departureTime: "08:00" }), 409, GUARD);
  });

  it("doesn't let an overdue pending request block the change", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    const stale = await insertTrip(commute, rider.userId, {
      tripDate: tomorrow(),
      expiresAt: new Date(Date.now() - 1000),
    });

    expectStatus(await editCommute(driver, commute.id, { departureTime: "08:05" }), 200);
    expect(await statusOf(stale.id)).toBe("expired");
  });

  it("allows the change when no trip still in play is ahead", async () => {
    const [{ driver: free, commute: noTrips }, { driver, commute }, rider] = await Promise.all([
      bookableCommute(),
      bookableCommute(),
      bookingRider(200),
    ]);
    await Promise.all([
      insertTrip(commute, rider.userId, { tripDate: addDays(today(), -1), status: "accepted" }),
      insertTrip(commute, rider.userId, { tripDate: tomorrow(), status: "declined" }),
      insertTrip(commute, rider.userId, { tripDate: addDays(tomorrow(), 1), status: "cancelled" }),
      insertTrip(commute, rider.userId, { tripDate: addDays(tomorrow(), 2), status: "expired" }),
    ]);

    const moved = await editCommute(free, noTrips.id, { departureTime: "08:15" });
    expectStatus(moved, 200);
    expect(moved.body.data.departureTime).toBe("08:15:00");

    const res = await editCommute(driver, commute.id, {
      departureTime: "06:45",
      recurrenceDays: [1, 2, 3, 4, 5],
      endLat: 5.5501,
    });
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      departureTime: "06:45:00",
      recurrenceDays: [1, 2, 3, 4, 5],
      endLat: 5.5501,
    });
  });
});

describe("activity log and docs", () => {
  it("records accepts and declines with the driver's before and after", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    const first = await requested(rider, commute);
    const second = await requested(rider, commute, { tripDate: addDays(tomorrow(), 1) });
    expectStatus(await accept(driver, first.id), 200);
    expectStatus(await decline(driver, second.id), 200);

    await flushActivityLogs();
    const entries = await db("activityLogs")
      .whereIn("targetId", [first.id, second.id])
      .whereIn("action", ["trip.accept", "trip.decline"]);
    const byAction = Object.fromEntries(entries.map((entry) => [entry.action, entry]));
    expect(byAction["trip.accept"]).toMatchObject({ actorId: driver.userId, targetId: first.id });
    expect(byAction["trip.accept"].changedFields).toEqual(
      expect.arrayContaining(["status", "heldAmount"]),
    );
    expect(byAction["trip.decline"]).toMatchObject({ actorId: driver.userId, targetId: second.id });
    for (const entry of entries) {
      const stored = JSON.stringify([entry.before, entry.after]);
      expect(stored).not.toContain(first.boardingCode);
      expect(stored).not.toContain(second.boardingCode);
      expect(stored).not.toContain(fullPhone(rider));
    }
  });

  it("documents the driver routes with their exact errors", async () => {
    const res = await api.get("/openapi.json");
    expectStatus(res, 200);
    const example = (method: string, path: string, status: number) =>
      res.body.paths[path]?.[method]?.responses[status]?.content["application/json"].example?.error;

    expect(example("post", "/trips/{id}/accept", 403)).toBe("Only the trip's driver can accept it");
    expect(example("post", "/trips/{id}/accept", 429)).toBe("Too many requests, try again later");
    expect(example("post", "/trips/{id}/decline", 409)).toBe(
      "Can't decline a trip that is accepted",
    );
    expect(example("get", "/commutes/{id}/trips", 429)).toBe("Too many requests, try again later");
    expect(example("get", "/commutes/{id}/trips", 404)).toMatch(/^Commute not found: /);
    expect(example("patch", "/commutes/{id}", 409)).toBe(
      "This commute has upcoming trips: pause it or cancel them before changing its route or schedule",
    );
  });
});
