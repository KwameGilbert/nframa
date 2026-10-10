import { describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { settingModel } from "../src/models/setting.model.js";
import { tripModel, type Trip } from "../src/models/trip.model.js";
import { walletModel } from "../src/models/wallet.model.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { roundMoney } from "../src/utils/money.js";
import { loggableResponse } from "../src/middlewares/httpLogger.js";
import { addDays, today } from "../src/utils/tripTime.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { signUpByPhone } from "./helpers/actors.js";
import {
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

// Boarding, wait billing, completion, no-shows and the lazy sweep. Times are set by moving a test trip's
// scheduled pickup (and arrival) in the database, relative to now.

type Viewer = { token: string };
type Point = { lat: number; lng: number };

const MINUTE = 60_000;
const OUT_OF_DATE = "The rider's location is out of date: ask them to open the app";
const NO_CODE = "No trip found for that code";

const settings = () =>
  settingModel.getValues([
    "trips.boardingRadiusMeters",
    "trips.locationMaxAgeSeconds",
    "trips.boardingEarlyMinutes",
    "trips.boardingLateMinutes",
    "trips.staleAfterHours",
    "fares.waitGraceMinutes",
    "fares.waitPerMinuteRate",
  ]);

const pickupOf = (trip: Trip): Point => ({ lat: trip.pickupLat, lng: trip.pickupLng });
// A point `meters` north of p.
const north = (p: Point, meters: number): Point => ({
  lat: Number((p.lat + meters / 111_320).toFixed(6)),
  lng: p.lng,
});

function shareLocation(viewer: Viewer, id: string, at: Point) {
  return api.put(`/trips/${id}/location`).set(auth(viewer.token)).send(at);
}

function arrive(viewer: Viewer, id: string, at: Point) {
  return api.post(`/trips/${id}/arrived`).set(auth(viewer.token)).send(at);
}

function scan(viewer: Viewer, code: string, at: Point) {
  return api
    .post("/trips/board")
    .set(auth(viewer.token))
    .send({ code, ...at });
}

function complete(viewer: Viewer, id: string) {
  return api.post(`/trips/${id}/complete`).set(auth(viewer.token));
}

function noShow(viewer: Viewer, id: string) {
  return api.post(`/trips/${id}/no-show`).set(auth(viewer.token));
}

// An accepted trip on today's run, from the commute's start, its total held in the rider's wallet, picked up
// pickupIn ms from now (negative: already past).
async function acceptedToday(
  commute: TestCommute,
  riderUserId: string,
  {
    pickupIn = -MINUTE,
    ...overrides
  }: Partial<Record<keyof Trip, unknown>> & { pickupIn?: number } = {},
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
    ...overrides,
  });
  if (trip.heldAmount > 0) {
    await db.transaction((trx) => walletModel.hold(trx, riderUserId, trip.heldAmount));
  }
  return trip;
}

// The rider's app has just shared its location at the point.
function riderAt(tripId: string, at: Point, ageMs = 0) {
  return db("trips")
    .where({ id: tripId })
    .update({ riderLat: at.lat, riderLng: at.lng, riderLocationAt: new Date(Date.now() - ageMs) });
}

async function ledger(userId: string) {
  return db("transactions")
    .where({ userId })
    .orderBy("createdAt")
    .select("type", "direction", "amount", "tripId", "status");
}

// A wallet's balance is always the signed sum of its successful ledger rows.
async function expectLedgerMatchesBalance(userId: string) {
  const [{ sum }] = await db("transactions")
    .where({ userId, status: "success" })
    .select(
      db.raw(
        `coalesce(sum(case when "direction" = 'credit' then "amount" else -"amount" end), 0) as sum`,
      ),
    );
  expect((await walletOf(userId)).balance).toBe(Number(sum));
}

async function expectInvariants(...userIds: string[]) {
  for (const userId of userIds) {
    await expectHoldsMatchTrips(userId);
    await expectLedgerMatchesBalance(userId);
  }
}

describe("PUT /trips/:id/location", () => {
  it("stores the rider's location for their own accepted trip today, and nothing else", async () => {
    const [{ driver, commute }, s] = await Promise.all([bookableCommute(), settings()]);
    const [rider, other] = await Promise.all([newRider(100), newRider(100)]);
    const trip = await acceptedToday(commute, rider.userId);
    const pending = await insertTrip(commute, other.userId, { tripDate: today() });
    const later = await acceptedToday(commute, rider.userId, {
      tripDate: tomorrow(),
      pickupIn: (s["trips.boardingEarlyMinutes"] + 60) * MINUTE,
      heldAmount: 0,
    });
    const at = { lat: 5.6225, lng: -0.1736 };

    const res = await shareLocation(rider, trip.id, at);
    expectStatus(res, 200);
    expect(res.body.message).toBe("Location shared successfully");
    expect(res.body.data).toMatchObject({ tripId: trip.id, ...at });
    const stored = (await tripModel.findById(trip.id))!;
    expect(stored).toMatchObject({ riderLat: at.lat, riderLng: at.lng });
    expect(Date.now() - stored.riderLocationAt!.getTime()).toBeLessThan(MINUTE);

    const notYours = "Only the trip's rider can share their location for it";
    expectError(await shareLocation(driver, trip.id, at), 403, notYours);
    expectError(await shareLocation(other, trip.id, at), 403, notYours);
    expectError(
      await shareLocation(other, pending.id, at),
      409,
      "Can't share your location for a trip that is pending",
    );
    const early = await shareLocation(rider, later.id, at);
    expectStatus(early, 409);
    expect(early.body.error).toMatch(/^You can share your location from /);
    expectError(
      await shareLocation(rider, trip.id, { lat: 91, lng: 0 }),
      400,
      "lat: Too big: expected number to be <=90",
    );
    const unknown = "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60";
    expectError(await shareLocation(rider, unknown, at), 404, `Trip not found: ${unknown}`);
    expect((await tripModel.findById(pending.id))!.riderLat).toBeNull();
  });
});

describe("POST /trips/:id/arrived", () => {
  it("marks arrival once, near the pickup and inside the boarding window", async () => {
    const [{ driver, commute }, { driver: otherDriver }, rider, s] = await Promise.all([
      bookableCommute(),
      bookableCommute(),
      newRider(100),
      settings(),
    ]);
    const trip = await acceptedToday(commute, rider.userId);
    const pickup = pickupOf(trip);
    const setPickup = (ms: number) =>
      db("trips")
        .where({ id: trip.id })
        .update({ scheduledPickupAt: new Date(Date.now() + ms) });

    expectError(
      await arrive(otherDriver, trip.id, pickup),
      403,
      "Only the trip's driver can mark arrival for it",
    );
    expectError(
      await arrive(rider, trip.id, pickup),
      403,
      "Only the trip's driver can mark arrival for it",
    );
    expectError(
      await arrive(driver, trip.id, north(pickup, s["trips.boardingRadiusMeters"] + 50)),
      409,
      "You're too far from the pickup point",
    );
    await setPickup((s["trips.boardingEarlyMinutes"] + 5) * MINUTE);
    const early = await arrive(driver, trip.id, pickup);
    expectStatus(early, 409);
    expect(early.body.error).toMatch(/^Boarding opens at /);
    await setPickup(-(s["trips.boardingLateMinutes"] + 5) * MINUTE);
    const late = await arrive(driver, trip.id, pickup);
    expectStatus(late, 409);
    expect(late.body.error).toMatch(/^Boarding closed at /);
    expect((await tripModel.findById(trip.id))!.arrivedAt).toBeNull();

    await setPickup(-MINUTE);
    const res = await arrive(driver, trip.id, north(pickup, 20));
    expectStatus(res, 200);
    expect(res.body.message).toBe("Arrival marked successfully");
    expect(res.body.data).toMatchObject({ status: "accepted", boardingCode: null });
    const arrivedAt = res.body.data.arrivedAt;
    expect(arrivedAt).not.toBeNull();

    // A repeat mark changes nothing, even from elsewhere.
    const again = await arrive(driver, trip.id, north(pickup, 5000));
    expectStatus(again, 200);
    expect(again.body.data.arrivedAt).toBe(arrivedAt);

    await db("trips").where({ id: trip.id }).update({ status: "boarded" });
    expectError(
      await arrive(driver, trip.id, pickup),
      409,
      "Can't mark arrival for a trip that is boarded",
    );
  });
});

describe("a whole trip through the API", () => {
  it("requests, accepts, boards, charges once, completes and pays the driver once", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    const requested = await requestTrip(rider, commute);
    expectStatus(requested, 201);
    const { id, boardingCode, totalAmount, fare } = requested.body.data;
    expectStatus(await api.post(`/trips/${id}/accept`).set(auth(driver.token)), 200);
    // Today's run, picked up a minute ago.
    await db("trips")
      .where({ id })
      .update({
        tripDate: today(),
        scheduledPickupAt: new Date(Date.now() - MINUTE),
        scheduledDropoffAt: new Date(Date.now() + 15 * MINUTE),
      });
    const trip = (await tripModel.findById(id))!;
    const pickup = pickupOf(trip);

    expectStatus(await shareLocation(rider, id, north(pickup, 10)), 200);
    expectStatus(await arrive(driver, id, pickup), 200);
    const boarded = await scan(driver, boardingCode, pickup);
    expectStatus(boarded, 200);
    expect(boarded.body.message).toBe("Rider boarded successfully");
    expect(boarded.body.data).toMatchObject({
      id,
      status: "boarded",
      heldAmount: 0,
      waitMinutes: 0,
      waitCharge: 0,
      driverEarnings: fare,
      boardingCode: null,
    });
    expect(boarded.body.data.boardedAt).not.toBeNull();
    expect(JSON.stringify(boarded.body.data)).not.toContain(boardingCode);
    expect(await walletOf(rider.userId)).toEqual({
      balance: roundMoney(200 - totalAmount),
      heldAmount: 0,
    });
    const charges = (await ledger(rider.userId)).filter((row) => row.tripId === id);
    expect(charges).toEqual([
      {
        type: "tripCharge",
        direction: "debit",
        amount: totalAmount.toFixed(2),
        tripId: id,
        status: "success",
      },
    ]);
    await expectInvariants(rider.userId);

    // Only the rider ever sees the code: not the driver's view, nor the manifest.
    const riderView = await api.get(`/trips/${id}`).set(auth(rider.token));
    expect(riderView.body.data).toMatchObject({ boardingCode, status: "boarded", waitCharge: 0 });
    const driverView = await api.get(`/trips/${id}`).set(auth(driver.token));
    expect(JSON.stringify(driverView.body.data)).not.toContain(boardingCode);
    const sheet = await api
      .get(`/commutes/${commute.id}/trips`)
      .set(auth(driver.token))
      .query({ date: today() });
    expectStatus(sheet, 200);
    expect(JSON.stringify(sheet.body.data)).not.toContain(boardingCode);

    const done = await complete(driver, id);
    expectStatus(done, 200);
    expect(done.body.message).toBe("Trip completed successfully");
    expect(done.body.data).toMatchObject({ status: "completed" });
    expect(done.body.data.completedAt).not.toBeNull();
    expectError(await complete(driver, id), 409, "Can't complete a trip that is completed");
    // The earning is held (finance.earningsHoldHours): in pendingBalance, not balance, until it's released.
    expect(await walletOf(driver.userId)).toEqual({ balance: 0, heldAmount: 0 });
    expect((await walletModel.getWallet(driver.userId)).pendingBalance).toBe(fare);
    expect(await ledger(driver.userId)).toEqual([
      {
        type: "driverEarning",
        direction: "credit",
        amount: fare.toFixed(2),
        tripId: id,
        status: "pending",
      },
    ]);
    expect((await walletOf(rider.userId)).balance).toBe(roundMoney(200 - totalAmount));
    // The platform's cut (its fee plus the booking fee) lands on the platform account, never a wallet.
    const platformRows = await db("transactions")
      .where({ account: "platform", tripId: id })
      .select("userId", "type", "direction", "amount", "status");
    expect(platformRows).toEqual([
      {
        userId: null,
        type: "platformFee",
        direction: "credit",
        amount: roundMoney(
          requested.body.data.platformFee + requested.body.data.bookingFee,
        ).toFixed(2),
        status: "success",
      },
    ]);
    await expectInvariants(rider.userId, driver.userId);

    await flushActivityLogs();
    const entries = await db("activityLogs")
      .where({ targetId: id })
      .whereIn("action", ["trip.arrive", "trip.board", "trip.complete"]);
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      "trip.arrive",
      "trip.board",
      "trip.complete",
    ]);
    for (const entry of entries) {
      expect(entry.actorId).toBe(driver.userId);
      expect(JSON.stringify([entry.before, entry.after, entry.requestBody])).not.toContain(
        boardingCode,
      );
    }
  });
});

describe("wait billing", () => {
  it("counts the wait from the later of arrival and the scheduled pickup, past the grace", async () => {
    const [{ driver, commute }, s] = await Promise.all([bookableCommute(), settings()]);
    const grace = s["fares.waitGraceMinutes"];
    const rate = s["fares.waitPerMinuteRate"];
    const riders = await Promise.all([1, 2, 3, 4].map(() => newRider(100)));
    // The extra seconds keep floor() on the intended minute while the request is in flight.
    const cases = [
      { label: "no arrival mark", pickupIn: -(grace + 15) * MINUTE, arrivedAgo: null, minutes: 0 },
      {
        label: "arrived before the pickup",
        pickupIn: -((grace + 10) * MINUTE + 10_000),
        arrivedAgo: (grace + 30) * MINUTE,
        minutes: grace + 10,
      },
      {
        label: "arrived after the pickup",
        pickupIn: -(grace + 20) * MINUTE,
        arrivedAgo: (grace + 7) * MINUTE + 10_000,
        minutes: grace + 7,
      },
      {
        label: "inside the grace",
        pickupIn: -(grace + 20) * MINUTE,
        arrivedAgo: Math.max(grace - 1, 0) * MINUTE + 10_000,
        minutes: Math.max(grace - 1, 0),
      },
    ];

    for (const [i, c] of cases.entries()) {
      const rider = riders[i];
      const trip = await acceptedToday(commute, rider.userId, {
        pickupIn: c.pickupIn,
        arrivedAt: c.arrivedAgo === null ? null : new Date(Date.now() - c.arrivedAgo),
      });
      await riderAt(trip.id, pickupOf(trip));

      const res = await scan(driver, trip.boardingCode, pickupOf(trip));
      expectStatus(res, 200);
      const charge = roundMoney(Math.max(0, c.minutes - grace) * rate);
      expect(res.body.data, c.label).toMatchObject({
        waitMinutes: c.minutes,
        waitCharge: charge,
        driverEarnings: roundMoney(trip.fare + charge),
      });
      const rows = (await ledger(rider.userId)).filter((row) => row.tripId === trip.id);
      expect(
        rows.map((row) => [row.type, Number(row.amount)]),
        c.label,
      ).toEqual([
        ["tripCharge", trip.totalAmount],
        ...(charge > 0 ? [["waitCharge", charge]] : []),
      ]);
      expect(await walletOf(rider.userId), c.label).toEqual({
        balance: roundMoney(100 - trip.totalAmount - charge),
        heldAmount: 0,
      });
      await expectInvariants(rider.userId);
    }
  });

  it("caps the wait charge at what the rider can still spend, never going below zero", async () => {
    const [{ driver, commute }, s] = await Promise.all([bookableCommute(), settings()]);
    const minutes = s["fares.waitGraceMinutes"] + 20;
    const owed = roundMoney(20 * s["fares.waitPerMinuteRate"]);
    expect(owed).toBeGreaterThan(0);
    // Enough for the fare and only half the wait.
    const spare = roundMoney(owed / 2);
    const rider = await bookingRider(roundMoney(30.04 + spare));
    const trip = await acceptedToday(commute, rider.userId, {
      pickupIn: -(minutes * MINUTE + 10_000),
      arrivedAt: new Date(Date.now() - (minutes + 5) * MINUTE),
    });
    await riderAt(trip.id, pickupOf(trip));

    const res = await scan(driver, trip.boardingCode, pickupOf(trip));
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      waitMinutes: minutes,
      waitCharge: spare,
      driverEarnings: roundMoney(trip.fare + spare),
    });
    const rows = (await ledger(rider.userId)).filter((row) => row.tripId === trip.id);
    expect(rows.map((row) => [row.type, Number(row.amount)])).toEqual([
      ["tripCharge", trip.totalAmount],
      ["waitCharge", spare],
    ]);
    expect(await walletOf(rider.userId)).toEqual({ balance: 0, heldAmount: 0 });
    await expectInvariants(rider.userId);
  });
});

describe("a pickup after midnight", () => {
  it("works for a trip dated the day before its scheduled pickup", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await newRider(100);
    // E.g. a late-night commute whose pickup, far along the route, falls just after midnight.
    const pickupAt = new Date(Date.now() - MINUTE);
    const trip = await acceptedToday(commute, rider.userId, {
      tripDate: addDays(today(pickupAt), -1),
    });
    const pickup = pickupOf(trip);

    expectStatus(await shareLocation(rider, trip.id, pickup), 200);
    expectStatus(await arrive(driver, trip.id, pickup), 200);
    const res = await scan(driver, trip.boardingCode, pickup);
    expectStatus(res, 200);
    expect(res.body.data.status).toBe("boarded");
    await expectInvariants(rider.userId);
  });
});

describe("POST /trips/board refusals", () => {
  it("refuses bad codes, the wrong time or place, and a rider who isn't there, charging nothing", async () => {
    const [{ driver, commute }, { commute: otherCommute }, s] = await Promise.all([
      bookableCommute(),
      bookableCommute(),
      settings(),
    ]);
    const [rider, otherRider] = await Promise.all([newRider(100), newRider(100)]);
    const trip = await acceptedToday(commute, rider.userId);
    const someoneElses = await acceptedToday(otherCommute, otherRider.userId);
    const pickup = pickupOf(trip);
    const radius = s["trips.boardingRadiusMeters"];
    const update = (fields: Record<string, unknown>) =>
      db("trips").where({ id: trip.id }).update(fields);

    expectError(await scan(rider, trip.boardingCode, pickup), 403, "Only drivers can board riders");
    expectError(await scan(driver, "TR-ZZZZZZ", pickup), 404, NO_CODE);
    expectError(await scan(driver, someoneElses.boardingCode, pickup), 404, NO_CODE);
    expectError(
      await api.post("/trips/board").set(auth(driver.token)).send(pickup),
      400,
      "code: Invalid input: expected string, received undefined",
    );

    // Where: the driver at the pickup, and the rider's fresh location near the driver.
    expectError(
      await scan(driver, trip.boardingCode, north(pickup, radius + 50)),
      409,
      "You're too far from the pickup point",
    );
    expectError(await scan(driver, trip.boardingCode, pickup), 409, OUT_OF_DATE);
    await riderAt(trip.id, pickup, (s["trips.locationMaxAgeSeconds"] + 30) * 1000);
    expectError(await scan(driver, trip.boardingCode, pickup), 409, OUT_OF_DATE);
    await riderAt(trip.id, north(pickup, radius * 2 + 50));
    expectError(
      await scan(driver, trip.boardingCode, pickup),
      409,
      "The rider isn't close enough to the vehicle",
    );
    await riderAt(trip.id, north(pickup, 10));

    // When: inside the window, on the trip's date.
    await update({
      scheduledPickupAt: new Date(Date.now() + (s["trips.boardingEarlyMinutes"] + 5) * MINUTE),
    });
    expect((await scan(driver, trip.boardingCode, pickup)).body.error).toMatch(
      /^Boarding opens at /,
    );
    await update({
      scheduledPickupAt: new Date(Date.now() - (s["trips.boardingLateMinutes"] + 5) * MINUTE),
    });
    expect((await scan(driver, trip.boardingCode, pickup)).body.error).toMatch(
      /^Boarding closed at /,
    );
    await update({ scheduledPickupAt: new Date(Date.now() - MINUTE), status: "pending" });
    expectError(
      await scan(driver, trip.boardingCode, pickup),
      409,
      "Can't board a trip that is pending",
    );
    await update({ status: "accepted" });

    expect(await walletOf(rider.userId)).toEqual({ balance: 100, heldAmount: trip.totalAmount });
    expect(await ledger(rider.userId)).toHaveLength(1); // the top-up

    // The code is read case-insensitively.
    expectStatus(await scan(driver, trip.boardingCode.toLowerCase(), pickup), 200);
    await expectInvariants(rider.userId, otherRider.userId);
  });

  it("stops code guessing at 60 scans per 15 minutes", async () => {
    const driver = await signUpByPhone("driver");
    const at = { lat: 5.6224, lng: -0.1737 };
    for (let i = 0; i < 60; i++) {
      expectError(await scan(driver, `TR-GUESS${i}`, at), 404, NO_CODE);
    }
    expectError(await scan(driver, "TR-GUESSX", at), 429, "Too many requests, try again later");
  });
});

describe("concurrency", () => {
  it("charges once for two simultaneous scans and pays once for two simultaneous completes", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await newRider(100);
    const trip = await acceptedToday(commute, rider.userId);
    await riderAt(trip.id, pickupOf(trip));

    const scans = await Promise.all([
      scan(driver, trip.boardingCode, pickupOf(trip)),
      scan(driver, trip.boardingCode, pickupOf(trip)),
    ]);
    expect(scans.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(scans.find((res) => res.status === 409)?.body.error).toBe(
      "Can't board a trip that is boarded",
    );
    expect((await ledger(rider.userId)).filter((row) => row.tripId === trip.id)).toHaveLength(1);
    expect(await walletOf(rider.userId)).toEqual({
      balance: roundMoney(100 - trip.totalAmount),
      heldAmount: 0,
    });

    const completes = await Promise.all([complete(driver, trip.id), complete(driver, trip.id)]);
    expect(completes.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await ledger(driver.userId)).toHaveLength(1);
    expect(await walletOf(driver.userId)).toEqual({ balance: 0, heldAmount: 0 });
    expect((await walletModel.getWallet(driver.userId)).pendingBalance).toBe(trip.fare);
    expect((await walletOf(rider.userId)).balance).toBe(roundMoney(100 - trip.totalAmount));
    await expectInvariants(rider.userId, driver.userId);
  });

  it("ends consistently when the driver scans while the rider cancels", async () => {
    const { driver, commute } = await bookableCommute();
    const riders = await Promise.all([1, 2, 3].map(() => newRider(100)));
    const trips = await Promise.all(riders.map((rider) => acceptedToday(commute, rider.userId)));
    for (const trip of trips) await riderAt(trip.id, pickupOf(trip));

    const results = await Promise.all(
      trips.map((trip, i) =>
        Promise.all([
          scan(driver, trip.boardingCode, pickupOf(trip)),
          api.post(`/trips/${trip.id}/cancel`).set(auth(riders[i].token)),
        ]),
      ),
    );

    for (const [i, [boarded, cancelled]] of results.entries()) {
      const trip = trips[i];
      const rider = riders[i];
      expect([boarded.status, cancelled.status].sort()).toEqual([200, 409]);
      const status = (await tripModel.findById(trip.id))!.status;
      if (boarded.status === 200) {
        expect(status).toBe("boarded");
        expect(cancelled.body.error).toBe("Can't cancel a trip that is boarded");
        expect(await walletOf(rider.userId)).toEqual({
          balance: roundMoney(100 - trip.totalAmount),
          heldAmount: 0,
        });
      } else {
        expect(status).toBe("cancelled");
        expect(boarded.body.error).toBe("Can't board a trip that is cancelled");
        expect(await walletOf(rider.userId)).toEqual({ balance: 100, heldAmount: 0 });
      }
      await expectInvariants(rider.userId);
    }
  });

  it("lets only one of a boarding and a no-show settle a trip", async () => {
    const { commute } = await bookableCommute();
    const riders = await Promise.all([1, 2, 3].map(() => newRider(100)));
    const trips = await Promise.all(riders.map((rider) => acceptedToday(commute, rider.userId)));
    const wait = { "fares.waitGraceMinutes": 5, "fares.waitPerMinuteRate": 0.5 };

    // Straight at the model: the routes' time checks never let both through, so this is the lock alone.
    const results = await Promise.allSettled(
      trips.flatMap((trip) => [
        tripModel.boardTrip(trip.id, pickupOf(trip), wait),
        tripModel.reportNoShow(trip.id, "driver"),
      ]),
    );
    for (const [i, trip] of trips.entries()) {
      const pair = results.slice(i * 2, i * 2 + 2);
      expect(pair.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const { status } = (await tripModel.findById(trip.id))!;
      const { balance } = await walletOf(riders[i].userId);
      expect(balance).toBe(status === "boarded" ? roundMoney(100 - trip.totalAmount) : 100);
      expect(["boarded", "no_show"]).toContain(status);
      await expectInvariants(riders[i].userId);
    }
  });
});

describe("the hold invariant at boarding", () => {
  it("refuses to board a trip whose hold isn't its total, instead of boarding it free", async () => {
    const { commute } = await bookableCommute();
    const rider = await newRider(100);
    const trip = await acceptedToday(commute, rider.userId, { heldAmount: 0 });
    const wait = { "fares.waitGraceMinutes": 5, "fares.waitPerMinuteRate": 0.5 };

    await expect(tripModel.boardTrip(trip.id, pickupOf(trip), wait)).rejects.toThrow(
      `Trip ${trip.id} holds 0, not its total ${trip.totalAmount}`,
    );
    expect((await tripModel.findById(trip.id))!.status).toBe("accepted");
    expect(await ledger(rider.userId)).toHaveLength(1); // the top-up
    await expectInvariants(rider.userId);
  });
});

describe("POST /trips/:id/no-show", () => {
  it("releases the hold once the boarding window has closed, charging nobody", async () => {
    const [{ driver, commute }, s] = await Promise.all([bookableCommute(), settings()]);
    const [rider, boardedRider] = await Promise.all([newRider(100), newRider(100)]);
    const trip = await acceptedToday(commute, rider.userId);
    const boarded = await acceptedToday(commute, boardedRider.userId, {
      status: "boarded",
      heldAmount: 0,
    });

    const early = await noShow(driver, trip.id);
    expectStatus(early, 409);
    expect(early.body.error).toMatch(/^You can report a no-show from /);
    expectError(
      await noShow(rider, trip.id),
      403,
      "Only the trip's driver can report a no-show for it",
    );
    expectError(
      await noShow(driver, boarded.id),
      409,
      "Can't report a no-show for a trip that is boarded",
    );

    await db("trips")
      .where({ id: trip.id })
      .update({
        scheduledPickupAt: new Date(Date.now() - (s["trips.boardingLateMinutes"] + 1) * MINUTE),
      });
    const res = await noShow(driver, trip.id);
    expectStatus(res, 200);
    expect(res.body.message).toBe("No-show reported successfully");
    expect(res.body.data).toMatchObject({
      status: "no_show",
      cancelledBy: "driver",
      cancellationReason: "Rider did not show up",
      heldAmount: 0,
    });
    expect(await walletOf(rider.userId)).toEqual({ balance: 100, heldAmount: 0 });
    expect(await ledger(driver.userId)).toEqual([]);
    expectError(
      await noShow(driver, trip.id),
      409,
      "Can't report a no-show for a trip that is no_show",
    );
    await expectInvariants(rider.userId);

    await flushActivityLogs();
    const entry = await db("activityLogs")
      .where({ targetId: trip.id, action: "trip.no_show" })
      .first();
    expect(entry).toMatchObject({ actorId: driver.userId });
  });
});

describe("the lazy sweep", () => {
  it("settles trips left unfinished trips.staleAfterHours after drop-off, on the next read", async () => {
    const [{ driver, commute }, s] = await Promise.all([bookableCommute(), settings()]);
    const [ama, kofi, efua] = await Promise.all([newRider(100), newRider(100), newRider(100)]);
    const hours = s["trips.staleAfterHours"];
    const ago = (h: number) => -(h * 60 + 18) * MINUTE; // pickup such that drop-off was h hours ago
    const abandoned = await acceptedToday(commute, ama.userId, { pickupIn: ago(hours + 1) });
    const unfinished = await acceptedToday(commute, kofi.userId, {
      pickupIn: ago(hours + 1),
      status: "boarded",
      heldAmount: 0,
    });
    const recent = await acceptedToday(commute, efua.userId, { pickupIn: ago(hours - 1) });

    // Several readers at once still settle each trip once.
    const reads = await Promise.all([
      api.get("/trips").set(auth(ama.token)).query({ when: "past" }),
      api.get("/trips").set(auth(driver.token)).query({ when: "past" }),
      api.get(`/trips/${unfinished.id}`).set(auth(driver.token)),
      api.get(`/trips/${abandoned.id}`).set(auth(ama.token)),
    ]);
    for (const res of reads) expectStatus(res, 200);

    expect(await tripModel.findById(abandoned.id)).toMatchObject({
      status: "no_show",
      cancelledBy: "system",
      heldAmount: 0,
    });
    expect(await walletOf(ama.userId)).toEqual({ balance: 100, heldAmount: 0 });
    expect(await tripModel.findById(unfinished.id)).toMatchObject({ status: "completed" });
    expect(await ledger(driver.userId)).toEqual([
      {
        type: "driverEarning",
        direction: "credit",
        amount: unfinished.driverEarnings.toFixed(2),
        tripId: unfinished.id,
        status: "pending",
      },
    ]);
    expect(await tripModel.findById(recent.id)).toMatchObject({ status: "accepted" });

    // Reading again settles nothing twice.
    expectStatus(await api.get("/trips").set(auth(driver.token)).query({ when: "past" }), 200);
    expect(await ledger(driver.userId)).toHaveLength(1);
    await expectInvariants(ama.userId, kofi.userId, efua.userId, driver.userId);
  });
});

describe("logging", () => {
  it("keeps the boarding code out of logged responses", () => {
    const body = {
      success: true,
      message: "Trip retrieved successfully",
      data: { id: "t1", boardingCode: "TR-7KQ2MX", status: "accepted" },
    };
    expect(loggableResponse(body)).toEqual({
      ...body,
      data: { id: "t1", boardingCode: "[REDACTED]", status: "accepted" },
    });
    expect(body.data.boardingCode).toBe("TR-7KQ2MX");
    const list = { success: true, message: "Trips retrieved successfully", data: { items: [] } };
    expect(loggableResponse(list)).toBe(list);
    expect(loggableResponse(undefined)).toBeUndefined();
  });
});

describe("docs", () => {
  it("documents the boarding routes with their exact errors", async () => {
    const res = await api.get("/openapi.json");
    expectStatus(res, 200);
    const example = (method: string, path: string, status: number) =>
      res.body.paths[path]?.[method]?.responses[status]?.content["application/json"].example?.error;

    expect(example("post", "/trips/board", 404)).toBe(NO_CODE);
    expect(example("post", "/trips/board", 403)).toBe("Only drivers can board riders");
    expect(example("post", "/trips/board", 409)).toBe(OUT_OF_DATE);
    expect(example("post", "/trips/board", 429)).toBe("Too many requests, try again later");
    expect(example("post", "/trips/board", 400)).toBe(
      "code: Invalid input: expected string, received undefined",
    );
    expect(example("put", "/trips/{id}/location", 403)).toBe(
      "Only the trip's rider can share their location for it",
    );
    expect(example("post", "/trips/{id}/arrived", 409)).toBe(
      "You're too far from the pickup point",
    );
    expect(example("post", "/trips/{id}/complete", 409)).toBe(
      "Can't complete a trip that is completed",
    );
    expect(example("post", "/trips/{id}/no-show", 403)).toBe(
      "Only the trip's driver can report a no-show for it",
    );
  });
});
