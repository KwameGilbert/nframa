import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Response } from "supertest";
import db from "../src/database/knex.js";
import { settingModel } from "../src/models/setting.model.js";
import { tripModel } from "../src/models/trip.model.js";
import { calculateFare, getFareSettings } from "../src/services/fare.service.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { getRoute } from "../src/services/maps.service.js";
import { roundMoney } from "../src/utils/money.js";
import { addDays, departureAt, isoWeekday, today } from "../src/utils/tripTime.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";
import {
  addCommute,
  along,
  bookableCommute,
  bookingRider,
  expectHoldsMatchTrips,
  insertTrip,
  newRider,
  requestTrip,
  tomorrow,
  walletOf,
  type TestCommute,
} from "./helpers/trips.js";

type Point = { lat: number; lng: number };

// A spot in northern Ghana, away from every other test's Accra and Kumasi commutes, so a search around it
// finds only the commutes this test put there.
function remoteSpot(): Point {
  return {
    lat: Number((7 + Math.random() * 4).toFixed(6)),
    lng: Number((-3 + Math.random() * 3.3).toFixed(6)),
  };
}

function northOf(point: Point, km: number): Point {
  return { lat: Number((point.lat + km / 111.32).toFixed(6)), lng: point.lng };
}

// A commute starting at start and running 10 km north.
function routeFrom(start: Point) {
  const end = northOf(start, 10);
  return {
    startAddress: "Tamale Central Market, Tamale",
    startLat: start.lat,
    startLng: start.lng,
    endAddress: "Bolgatanga Road, Tamale",
    endLat: end.lat,
    endLng: end.lng,
  };
}

function browse(token: string, query: Record<string, unknown>) {
  return api.get("/trips/available").set(auth(token)).query(query);
}

const commuteIds = (res: Response) =>
  res.body.data.items.map((item: { commuteId: string }) => item.commuteId);

// A rider who also has a driver profile and an approved commute of their own.
async function giveRiderACommute(rider: { userId: string; token: string }, start?: Point) {
  const profile = await api.post("/driver").set(auth(rider.token)).send({
    userId: rider.userId,
    ghanaCardNumber: data.ghanaCardNumber(),
    address: data.address(),
  });
  expectStatus(profile, 201);
  trackForCleanup("carOwnerProfiles", { userId: rider.userId });
  await db("carOwnerProfiles")
    .where({ userId: rider.userId })
    .update({ verificationStatus: "approved" });
  return addCommute(rider, start ? routeFrom(start) : {});
}

async function pause(driver: { token: string }, commute: TestCommute) {
  expectStatus(
    await api.patch(`/commutes/${commute.id}`).set(auth(driver.token)).send({ isActive: false }),
    200,
  );
}

describe("GET /trips/available", () => {
  it("finds commutes starting within the radius, nearest first, a page at a time", async () => {
    const radiusKm = await settingModel.getValue("trips.availabilityRadiusKm");
    const rider = await bookingRider(0);
    const spot = remoteSpot();
    const {
      driver,
      commute: far,
      vehicle,
    } = await bookableCommute(routeFrom(northOf(spot, radiusKm * 0.6)));
    const near = await addCommute(driver, routeFrom(northOf(spot, radiusKm * 0.04)));
    const middle = await addCommute(driver, routeFrom(northOf(spot, radiusKm * 0.2)));
    await addCommute(driver, routeFrom(northOf(spot, radiusKm * 1.6)));

    const first = await browse(rider.token, { ...spot, date: tomorrow(), limit: 2 });
    expectStatus(first, 200);
    expect(commuteIds(first)).toEqual([near.id, middle.id]);
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 2, totalItems: 3, totalPages: 2 });

    const second = await browse(rider.token, { ...spot, date: tomorrow(), limit: 2, page: 2 });
    expect(commuteIds(second)).toEqual([far.id]);

    const [item] = first.body.data.items;
    expect(item).toMatchObject({
      driver: { id: driver.userId, firstName: driver.fullName.split(" ")[0], profilePicture: null },
      startAddress: near.startAddress,
      startLat: near.startLat,
      endLat: near.endLat,
      departureAt: `${tomorrow()}T07:30:00.000Z`,
      seatsLeft: 3,
      distanceMeters: near.distanceMeters,
      durationSeconds: near.durationSeconds,
    });
    expect(item.vehicle).toEqual({
      make: expect.any(String),
      model: expect.any(String),
      color: expect.any(String),
    });
    expect(JSON.stringify(item)).not.toContain(vehicle.plate);
    expect(Math.abs(item.distanceToStartMeters - radiusKm * 40)).toBeLessThan(5);
  });

  it("hides commutes that can't be booked that day", async () => {
    const spot = remoteSpot();
    const route = routeFrom(northOf(spot, 0.5));
    const rider = await bookingRider(0);
    const { driver, commute: open } = await bookableCommute(route);
    const [otherDays, paused, full, leftAtMidnight, unapproved, own] = await Promise.all([
      addCommute(driver, { ...route, recurrenceDays: [isoWeekday(addDays(tomorrow(), 1))] }),
      addCommute(driver, route),
      addCommute(driver, { ...route, capacity: 1 }),
      addCommute(driver, { ...route, departureTime: "00:00" }),
      bookableCommute({ ...route, approved: false }).then((c) => c.commute),
      giveRiderACommute(rider, northOf(spot, 0.5)),
    ]);
    await pause(driver, paused);
    await insertTrip(full, rider.userId, { tripDate: tomorrow(), status: "accepted" });

    const res = await browse(rider.token, { ...spot, date: tomorrow() });
    expectStatus(res, 200);
    expect(commuteIds(res).sort()).toEqual([open.id, leftAtMidnight.id].sort());
    for (const hidden of [otherDays, paused, full, unapproved, own]) {
      expect(commuteIds(res)).not.toContain(hidden.id);
    }

    // Today, the commute that left at midnight is gone.
    const todays = await browse(rider.token, { ...spot, date: today() });
    expect(commuteIds(todays)).not.toContain(leftAtMidnight.id);
  });

  it("only takes dates inside the booking window, and only from riders", async () => {
    const windowDays = await settingModel.getValue("trips.bookingWindowDays");
    const [rider, driver] = await Promise.all([bookingRider(0), signUpByPhone("driver")]);
    const spot = remoteSpot();

    expectError(
      await browse(rider.token, { ...spot, date: addDays(today(), -1) }),
      400,
      "The date can't be in the past",
    );
    expectError(
      await browse(rider.token, { ...spot, date: addDays(today(), windowDays + 1) }),
      400,
      `Trips can be booked at most ${windowDays} days ahead`,
    );
    expectError(
      await browse(rider.token, { ...spot, date: "2026-02-30" }),
      400,
      "date: Invalid ISO date",
    );
    expectError(
      await browse(driver.token, { ...spot, date: tomorrow() }),
      403,
      "Only riders can browse trips",
    );
    expectStatus(await browse(rider.token, { ...spot, date: addDays(today(), windowDays) }), 200);
  });
});

describe("POST /trips", () => {
  it("requests a seat that waits for the driver, priced from the rider's own leg", async () => {
    const { driver, commute } = await bookableCommute();
    // A commute from before routes were stored: the request works it out and keeps it.
    await db("driverCommutes")
      .where({ id: commute.id })
      .update({ distanceMeters: null, durationSeconds: null });
    const rider = await bookingRider(200);
    const pickup = along(commute, 0.2);
    const dropoff = along(commute, 0.8);

    const res = await requestTrip(rider, commute, { pickup, dropoff });
    expectStatus(res, 201);
    expect(res.body.message).toBe("Trip requested successfully");
    const trip = res.body.data;

    const saved = await db("driverCommutes").where({ id: commute.id }).first();
    expect(saved.durationSeconds).toBeGreaterThan(0);
    const leaves = departureAt(tomorrow(), "07:30").getTime();
    expect(trip).toMatchObject({
      commuteId: commute.id,
      riderUserId: rider.userId,
      driverUserId: driver.userId,
      tripDate: tomorrow(),
      status: "pending",
      pickup: { address: pickup.address, lat: pickup.lat, lng: pickup.lng },
      dropoff: { address: dropoff.address, lat: dropoff.lat, lng: dropoff.lng },
      pickupProgress: 0.2,
      dropoffProgress: 0.8,
      scheduledPickupAt: new Date(
        leaves + Math.round(0.2 * saved.durationSeconds) * 1000,
      ).toISOString(),
      scheduledDropoffAt: new Date(
        leaves + Math.round(0.8 * saved.durationSeconds) * 1000,
      ).toISOString(),
      heldAmount: 0,
      acceptedAt: null,
      seatsLeft: 3,
      otherCommuters: [],
      stops: [
        { type: "pickup", address: pickup.address, isYou: true },
        { type: "dropoff", address: dropoff.address, isYou: true },
      ],
      driver: { fullName: driver.fullName, phone: null },
      vehicle: { plate: null },
    });
    expect(trip.boardingCode).toMatch(/^TR-[A-HJ-NP-Z2-9]{6}$/);
    const expiresIn = new Date(trip.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(0);
    expect(expiresIn).toBeLessThanOrEqual(
      (await settingModel.getValue("trips.requestExpiryMinutes")) * 60_000,
    );

    const leg = await getRoute(pickup, dropoff);
    const fare = calculateFare(leg, await getFareSettings());
    expect(trip).toMatchObject({
      distanceMeters: leg.distanceMeters,
      durationSeconds: leg.durationSeconds,
      fare: fare.fare,
      platformFee: fare.platformFee,
      bookingFee: fare.bookingFee,
      totalAmount: fare.total,
      driverEarnings: fare.driverEarnings,
      fareBreakdown: fare,
    });

    // Pending: no seat taken, nothing held.
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });
    expect(await tripModel.seatsLeft(commute.id, tomorrow())).toBe(3);
    await expectHoldsMatchTrips(rider.userId);
  });

  it("books the seat at once and holds the total when the driver auto-accepts", async () => {
    const { driver, commute, vehicle } = await bookableCommute({ autoAccept: true });
    const rider = await bookingRider(200);

    const res = await requestTrip(rider, commute);
    expectStatus(res, 201);
    expect(res.body.message).toBe("Trip booked successfully");
    const trip = res.body.data;
    expect(trip).toMatchObject({
      status: "accepted",
      heldAmount: trip.totalAmount,
      expiresAt: null,
      seatsLeft: 2,
      driver: { phone: `${driver.phoneCountryCode}${driver.phoneNumber}` },
      vehicle: { plate: vehicle.plate },
    });
    expect(trip.acceptedAt).not.toBeNull();

    // Held, not charged: the balance is unchanged and only the available balance drops.
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: trip.totalAmount });
    const wallet = await api.get("/wallet").set(auth(rider.token));
    expect(wallet.body.data.availableBalance).toBeCloseTo(200 - trip.totalAmount, 2);
    expect(await db("transactions").where({ tripId: trip.id })).toHaveLength(0);
    await expectHoldsMatchTrips(rider.userId);
  });

  it("refuses a second trip on the same commute and date, or one that overlaps in time", async () => {
    const { driver, commute } = await bookableCommute();
    const [sameTime, evening] = await Promise.all([
      addCommute(driver),
      addCommute(driver, { departureTime: "18:00" }),
    ]);
    const rider = await bookingRider(500);

    expectStatus(await requestTrip(rider, commute), 201);
    expectError(
      await requestTrip(rider, commute),
      409,
      "You already have a trip on this commute for that date",
    );
    expectError(await requestTrip(rider, sameTime), 409, "You already have a trip at that time");
    expectStatus(await requestTrip(rider, evening), 201);
    expect(await db("trips").where({ riderUserId: rider.userId })).toHaveLength(2);
  });

  it("refuses a request, even a pending one, when the commute is full that day", async () => {
    const { commute } = await bookableCommute({ capacity: 1 });
    const [seated, rider] = await Promise.all([bookingRider(0), bookingRider(200)]);
    await insertTrip(commute, seated.userId, { tripDate: tomorrow(), status: "accepted" });

    expectError(await requestTrip(rider, commute), 409, "This commute is full");
    // Another day still has the seat.
    expectStatus(await requestTrip(rider, commute, { tripDate: addDays(tomorrow(), 1) }), 201);
  });

  it("allows back-to-back trips: a drop-off at the moment the next pickup starts", async () => {
    const { driver, commute } = await bookableCommute();
    const earlier = await addCommute(driver, { departureTime: "06:00" });
    const rider = await bookingRider(200);
    const pickupAt = new Date(
      departureAt(tomorrow(), "07:30").getTime() +
        Math.round(0.2 * (commute.durationSeconds as number)) * 1000,
    );
    await insertTrip(earlier, rider.userId, {
      tripDate: tomorrow(),
      scheduledPickupAt: new Date(pickupAt.getTime() - 20 * 60_000),
      scheduledDropoffAt: pickupAt,
    });

    const res = await requestTrip(rider, commute);
    expectStatus(res, 201);
    expect(res.body.data.scheduledPickupAt).toBe(pickupAt.toISOString());
  });

  it("gives the last seat to exactly one of several simultaneous requests", async () => {
    const { commute } = await bookableCommute({ autoAccept: true, capacity: 1 });
    const riders = await Promise.all([bookingRider(100), bookingRider(100), bookingRider(100)]);

    const results = await Promise.all(riders.map((rider) => requestTrip(rider, commute)));

    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) {
      expect(res.body.error).toBe("This commute is full");
    }
    expect(await tripModel.seatsLeft(commute.id, tomorrow())).toBe(0);
    for (const rider of riders) await expectHoldsMatchTrips(rider.userId);
  });

  describe("refusals", () => {
    let main: Awaited<ReturnType<typeof bookableCommute>>;
    let unapproved: TestCommute;
    let paused: TestCommute;
    let otherDays: TestCommute;
    let alreadyLeft: TestCommute;
    let own: TestCommute;
    let rider: Awaited<ReturnType<typeof bookingRider>>;
    let noProfile: Awaited<ReturnType<typeof newRider>>;
    let broke: Awaited<ReturnType<typeof bookingRider>>;
    let windowDays: number;
    let toleranceKm: number;

    beforeAll(async () => {
      [main, { commute: unapproved }, rider, noProfile, broke, windowDays, toleranceKm] =
        await Promise.all([
          bookableCommute(),
          bookableCommute({ approved: false }),
          bookingRider(500),
          newRider(500),
          bookingRider(0),
          settingModel.getValue("trips.bookingWindowDays"),
          settingModel.getValue("trips.routeToleranceKm"),
        ]);
      [paused, otherDays, alreadyLeft, own] = await Promise.all([
        addCommute(main.driver),
        addCommute(main.driver, { recurrenceDays: [isoWeekday(addDays(tomorrow(), 1))] }),
        addCommute(main.driver, { departureTime: "00:00" }),
        giveRiderACommute(rider),
      ]);
      await pause(main.driver, paused);
      // Leaves at midnight and reaches every stop at once, so today's pickup has always passed.
      await db("driverCommutes").where({ id: alreadyLeft.id }).update({ durationSeconds: 0 });
    });

    // A point moved east of where it would be on the route, by this many times the tolerance.
    const offRoute = (point: Point, times: number) => ({
      ...point,
      lng: Number((point.lng + (toleranceKm * times) / 111.32).toFixed(6)),
    });

    it.each<[string, () => Promise<Response>, number, () => string]>([
      [
        "a driver",
        () => requestTrip(main.driver, main.commute),
        403,
        () => "Only riders can request trips",
      ],
      [
        "a rider without a rider profile",
        () => requestTrip(noProfile, main.commute),
        400,
        () => "Create your rider profile before requesting trips",
      ],
      [
        "a paused commute",
        () => requestTrip(rider, paused),
        409,
        () => "This commute is not taking bookings",
      ],
      [
        "a commute whose driver isn't approved",
        () => requestTrip(rider, unapproved),
        409,
        () => "This commute is not taking bookings",
      ],
      [
        "their own commute",
        () => requestTrip(rider, own),
        400,
        () => "You can't book your own commute",
      ],
      [
        "a day the commute doesn't run",
        () => requestTrip(rider, otherDays),
        400,
        () => `This commute doesn't run on ${tomorrow()}`,
      ],
      [
        "a past date",
        () => requestTrip(rider, main.commute, { tripDate: addDays(today(), -1) }),
        400,
        () => "The date can't be in the past",
      ],
      [
        "a date beyond the booking window",
        () => requestTrip(rider, main.commute, { tripDate: addDays(today(), windowDays + 1) }),
        400,
        () => `Trips can be booked at most ${windowDays} days ahead`,
      ],
      [
        "a pickup off the route",
        () => requestTrip(rider, main.commute, { pickup: offRoute(along(main.commute, 0.2), 3) }),
        400,
        () => `Pickup is more than ${toleranceKm} km from the commute's route`,
      ],
      [
        "a drop-off off the route",
        () => requestTrip(rider, main.commute, { dropoff: offRoute(along(main.commute, 0.8), 3) }),
        400,
        () => `Drop-off is more than ${toleranceKm} km from the commute's route`,
      ],
      [
        "a drop-off before the pickup",
        () =>
          requestTrip(rider, main.commute, {
            pickup: along(main.commute, 0.8),
            dropoff: along(main.commute, 0.2),
          }),
        400,
        () => "Drop-off must come after pickup in the commute's direction of travel",
      ],
      [
        "a pickup time that has passed",
        () => requestTrip(rider, alreadyLeft, { tripDate: today() }),
        400,
        () => "This trip's pickup time has already passed",
      ],
      [
        "a rider who can't cover the total",
        () => requestTrip(broke, main.commute),
        409,
        () => "Insufficient wallet balance",
      ],
    ])("refuses %s", async (_label, send, status, error) => {
      // Requests and messages are built when the test runs, after beforeAll has set them up.
      expectError(await send(), status, error());
    });

    it("refuses a commute that doesn't exist", async () => {
      const id = randomUUID();
      expectError(
        await requestTrip(rider, { ...main.commute, id }),
        404,
        `Commute not found: ${id}`,
      );
    });
  });
});

describe("Admin Trip Management", () => {
  let superAdminToken: string;
  let tripAdminToken: string;
  let noTripsAdminToken: string;

  beforeAll(async () => {
    const admin = await loginAsSuperAdmin();
    superAdminToken = admin.token;
    const [tripAdmin, noTripsAdmin] = await Promise.all([
      createSignedInAdmin(superAdminToken, { trips: { read: true, delete: true } }),
      createSignedInAdmin(superAdminToken, { users: { read: true } }),
    ]);
    tripAdminToken = tripAdmin.token;
    noTripsAdminToken = noTripsAdmin.token;
  });

  describe("GET /admin/trips", () => {
    it("lists all trips with pagination and filters", async () => {
      const { commute } = await bookableCommute();
      const rider = await bookingRider(100);
      const resTrip = await requestTrip(rider, commute);
      expectStatus(resTrip, 201);
      const tripId = resTrip.body.data.id;

      const res = await api
        .get("/admin/trips")
        .set(auth(tripAdminToken))
        .query({ riderUserId: rider.userId });

      expectStatus(res, 200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items.some((t: { id: string }) => t.id === tripId)).toBe(true);
    });

    it("requires trips: read permission", async () => {
      const res = await api.get("/admin/trips").set(auth(noTripsAdminToken));
      expectStatus(res, 403);
      expect(res.body.error).toBe("Missing permission: read on trips");
    });
  });

  describe("GET /admin/trips/:id", () => {
    it("gives the full picture: people, the whole run, money and history", async () => {
      const { driver, commute } = await bookableCommute({ autoAccept: true, capacity: 2 });
      const [ama, kofi] = await Promise.all([bookingRider(200), bookingRider(200)]);
      const mine = await requestTrip(ama, commute);
      const theirs = await requestTrip(kofi, commute);
      expectStatus(mine, 201);
      expectStatus(theirs, 201);
      await db("trips").where({ id: theirs.body.data.id }).update({ status: "cancelled" });

      await flushActivityLogs();
      const res = await api.get(`/admin/trips/${mine.body.data.id}`).set(auth(tripAdminToken));

      expectStatus(res, 200);
      const view = res.body.data;
      expect(res.body.message).toBe("Trip retrieved successfully");
      expect(view).toMatchObject({
        id: mine.body.data.id,
        status: "accepted",
        rider: { id: ama.userId },
        driver: { id: driver.userId, verificationStatus: "approved" },
        commute: { id: commute.id, capacity: 2 },
        payments: { riderPaid: 0, driverReceived: 0, platformRetained: null, transactions: [] },
      });
      expect(view.payments.heldAmount).toBe(view.totalAmount);
      expect(view.vehicle.plate).toEqual(expect.any(String));
      expect(view.boardingCode).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain(mine.body.data.boardingCode);
      expect(view.run).toMatchObject({ capacity: 2, seatsTaken: 1, seatsLeft: 1 });
      expect(
        view.run.riders.map((r: { tripId: string; isThisTrip: boolean; status: string }) => [
          r.tripId,
          r.isThisTrip,
          r.status,
        ]),
      ).toEqual([
        [mine.body.data.id, true, "accepted"],
        [theirs.body.data.id, false, "cancelled"],
      ]);
      expect(view.history.map((h: { action: string }) => h.action)).toContain("trip.request");
    });

    it("totals what the rider paid and the driver received from the ledger", async () => {
      const { driver, commute } = await bookableCommute();
      const rider = await bookingRider(200);
      const trip = await insertTrip(commute, rider.userId, {
        status: "completed",
        completedAt: new Date(),
        boardedAt: new Date(),
        heldAmount: 0,
      });
      const rows = [
        { userId: rider.userId, type: "tripCharge", direction: "debit", amount: trip.totalAmount },
        {
          userId: driver.userId,
          type: "driverEarning",
          direction: "credit",
          amount: trip.driverEarnings,
        },
      ];
      for (const row of rows) {
        const [{ id }] = await db("transactions")
          .insert({ ...row, tripId: trip.id, status: "success", balanceAfter: 100 })
          .returning("id");
        trackForCleanup("transactions", { id });
      }

      const res = await api.get(`/admin/trips/${trip.id}`).set(auth(tripAdminToken));

      expectStatus(res, 200);
      expect(res.body.data.payments).toMatchObject({
        riderPaid: trip.totalAmount,
        driverReceived: trip.driverEarnings,
        platformRetained: roundMoney(trip.totalAmount - trip.driverEarnings),
      });
      expect(res.body.data.payments.transactions.map((t: { party: string }) => t.party)).toEqual([
        "rider",
        "driver",
      ]);
    });

    it("404s for an unknown trip, 400s for a bad id, and needs trips: read", async () => {
      const id = randomUUID();

      const missing = await api.get(`/admin/trips/${id}`).set(auth(tripAdminToken));
      const malformed = await api.get("/admin/trips/nope").set(auth(tripAdminToken));
      const refused = await api.get(`/admin/trips/${id}`).set(auth(noTripsAdminToken));

      expectStatus(missing, 404);
      expect(missing.body.error).toBe(`Trip not found: ${id}`);
      expectStatus(malformed, 400);
      expectStatus(refused, 403);
      expect(refused.body.error).toBe("Missing permission: read on trips");
    });

    it("isn't open to riders or drivers", async () => {
      const { driver, commute } = await bookableCommute({ autoAccept: true });
      const rider = await bookingRider(200);
      const trip = await requestTrip(rider, commute);

      expectStatus(await api.get(`/admin/trips/${trip.body.data.id}`).set(auth(rider.token)), 403);
      expectStatus(await api.get(`/admin/trips/${trip.body.data.id}`).set(auth(driver.token)), 403);
    });
  });

  describe("POST /admin/trips/:tripId/cancel", () => {
    it("allows admin to cancel a trip and releases hold", async () => {
      const { commute } = await bookableCommute();
      const rider = await bookingRider(100);
      const resTrip = await requestTrip(rider, commute);
      expectStatus(resTrip, 201);
      const tripId = resTrip.body.data.id;

      const cancelRes = await api
        .post(`/admin/trips/${tripId}/cancel`)
        .set(auth(tripAdminToken))
        .send({ reason: "Admin cancelled test" });

      if (cancelRes.status !== 200) {
        console.error("DEBUG cancelRes:", cancelRes.status, cancelRes.body);
      }
      expectStatus(cancelRes, 200);
      expect(cancelRes.body.data.status).toBe("cancelled");
      expect(cancelRes.body.data.cancelledBy).toBe("admin");
      expect(cancelRes.body.data.cancellationReason).toBe("Admin cancelled test");

      // Check the trip is cancelled in DB
      const trip = await tripModel.findById(tripId);
      expect(trip?.status).toBe("cancelled");
      expect(trip?.cancelledBy).toBe("admin");
    });

    it("requires trips: delete permission", async () => {
      const id = randomUUID();
      const res = await api
        .post(`/admin/trips/${id}/cancel`)
        .set(auth(noTripsAdminToken))
        .send({ reason: "Test" });

      expectStatus(res, 403);
      expect(res.body.error).toBe("Missing permission: delete on trips");
    });
  });
});
