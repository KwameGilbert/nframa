import { describe, expect, it } from "vitest";
import type { Knex } from "knex";
import db from "../src/database/knex.js";
import { walletModel } from "../src/models/wallet.model.js";
import { tripModel } from "../src/models/trip.model.js";
import { AppError } from "../src/utils/AppError.js";
import { addDays, today } from "../src/utils/tripTime.js";
import {
  expectHoldsMatchTrips,
  insertTrip,
  newCommute,
  newRider,
  walletOf,
} from "./helpers/trips.js";

const UNIQUE_VIOLATION = { code: "23505" };
const CHECK_VIOLATION = { code: "23514" };

function inTrx<T>(work: (trx: Knex.Transaction) => Promise<T>) {
  return db.transaction(work);
}

async function ledgerSum(userId: string) {
  const [{ sum }] = await db("transactions")
    .where({ userId, status: "success" })
    .select(
      db.raw(
        `coalesce(sum(case when direction = 'credit' then amount else -amount end), 0) as sum`,
      ),
    );
  return Number(sum);
}

describe("walletModel.hold", () => {
  it("reserves money only out of the available balance (balance - held)", async () => {
    const rider = await newRider(50);

    await inTrx((trx) => walletModel.hold(trx, rider.userId, 30));
    // 25 is less than the balance (50) but more than what's still available (20).
    const refused = inTrx((trx) => walletModel.hold(trx, rider.userId, 25));
    await expect(refused).rejects.toBeInstanceOf(AppError);
    await expect(refused).rejects.toMatchObject({
      statusCode: 409,
      message: "Insufficient wallet balance",
    });
    await inTrx((trx) => walletModel.hold(trx, rider.userId, 20));

    expect(await walletModel.getWallet(rider.userId)).toEqual({
      balance: 50,
      heldAmount: 50,
      availableBalance: 0,
    });
  });

  it("refuses a hold for an account that has no wallet yet", async () => {
    const rider = await newRider();

    await expect(inTrx((trx) => walletModel.hold(trx, rider.userId, 1))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await db("wallets").where({ userId: rider.userId }).first()).toBeUndefined();
  });

  it("never over-reserves under simultaneous holds", async () => {
    const rider = await newRider(100);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => inTrx((trx) => walletModel.hold(trx, rider.userId, 30))),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });
    }
    expect(await walletOf(rider.userId)).toEqual({ balance: 100, heldAmount: 90 });
  });
});

describe("walletModel.release", () => {
  it("gives held money back, and refuses to release more than is held", async () => {
    const rider = await newRider(40);
    await inTrx((trx) => walletModel.hold(trx, rider.userId, 35));

    await inTrx((trx) => walletModel.release(trx, rider.userId, 15));
    expect(await walletModel.getAvailableBalance(rider.userId)).toBe(20);

    await expect(inTrx((trx) => walletModel.release(trx, rider.userId, 50))).rejects.toMatchObject(
      CHECK_VIOLATION,
    );
    expect(await walletOf(rider.userId)).toEqual({ balance: 40, heldAmount: 20 });
    expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(1);
  });
});

describe("trip money amounts", () => {
  it.each([0, -5, 0.004])("refuses to hold, release or capture %s", async (amount) => {
    const { commute } = await newCommute();
    const rider = await newRider(40);
    const trip = await insertTrip(commute, rider.userId);
    await inTrx((trx) => walletModel.hold(trx, rider.userId, 10));

    for (const move of [
      // void: the moves return different things, and only whether they throw matters here.
      (trx: Knex.Transaction) => walletModel.hold(trx, rider.userId, amount),
      (trx: Knex.Transaction) => walletModel.release(trx, rider.userId, amount),
      async (trx: Knex.Transaction) =>
        void (await walletModel.capture(trx, { userId: rider.userId, tripId: trip.id, amount })),
    ]) {
      await expect(inTrx(move)).rejects.toThrow("Trip money amounts must be positive");
    }
    expect(await walletOf(rider.userId)).toEqual({ balance: 40, heldAmount: 10 });
    expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(1);
  });
});

describe("trip money from hold to payout", () => {
  it("holds on accept, captures once at boarding, bills wait time and pays the driver once", async () => {
    const { commute, driver } = await newCommute();
    const rider = await newRider(70);
    const trip = await insertTrip(commute, rider.userId);
    const otherDay = await insertTrip(commute, rider.userId, {
      tripDate: addDays(trip.tripDate, 1),
    });

    // Accepting both: each trip records what it holds in the same transaction as the wallet hold.
    for (const t of [trip, otherDay]) {
      await inTrx(async (trx) => {
        await trx("trips")
          .where({ id: t.id })
          .update({ status: "accepted", heldAmount: t.totalAmount, expiresAt: null });
        await walletModel.hold(trx, rider.userId, t.totalAmount);
      });
      await expectHoldsMatchTrips(rider.userId);
    }
    expect((await walletOf(rider.userId)).heldAmount).toBe(60.08);

    // The other day is cancelled: its hold is released, nobody is charged.
    await inTrx(async (trx) => {
      await trx("trips").where({ id: otherDay.id }).update({ status: "cancelled", heldAmount: 0 });
      await walletModel.release(trx, rider.userId, otherDay.totalAmount);
    });
    await expectHoldsMatchTrips(rider.userId);

    const board = () =>
      inTrx(async (trx) => {
        const charge = await walletModel.capture(trx, {
          userId: rider.userId,
          tripId: trip.id,
          amount: trip.totalAmount,
        });
        await trx("trips").where({ id: trip.id }).update({ status: "boarded", heldAmount: 0 });
        return charge;
      });

    const charge = await board();
    expect(charge).toMatchObject({
      userId: rider.userId,
      tripId: trip.id,
      type: "trip_charge",
      direction: "debit",
      amount: 30.04,
      status: "success",
      balanceAfter: 39.96,
    });
    await expectHoldsMatchTrips(rider.userId);
    expect(await walletOf(rider.userId)).toEqual({ balance: 39.96, heldAmount: 0 });

    // A second capture for the same trip is refused by the database and changes nothing: with nothing left
    // held the release fails, and even a second trip_charge on its own hits the one-per-trip index.
    await expect(board()).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      walletModel.record({
        userId: rider.userId,
        tripId: trip.id,
        type: "trip_charge",
        direction: "debit",
        amount: 1,
      }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
    expect(await walletOf(rider.userId)).toEqual({ balance: 39.96, heldAmount: 0 });

    // Wait time may take the rider below zero; it's billed once.
    const wait = {
      userId: rider.userId,
      tripId: trip.id,
      type: "wait_charge",
      direction: "debit",
    } as const;
    const waitCharge = await walletModel.record({ ...wait, amount: 45 });
    expect(waitCharge.balanceAfter).toBe(-5.04);
    await expect(walletModel.record({ ...wait, amount: 1 })).rejects.toMatchObject(
      UNIQUE_VIOLATION,
    );

    // The driver is paid the fare plus the wait charge, once.
    const earning = {
      userId: driver.userId,
      tripId: trip.id,
      type: "driver_earning",
      direction: "credit",
    } as const;
    await walletModel.record({ ...earning, amount: trip.driverEarnings + 45 });
    await expect(walletModel.record({ ...earning, amount: 1 })).rejects.toMatchObject(
      UNIQUE_VIOLATION,
    );

    for (const userId of [rider.userId, driver.userId]) {
      expect((await walletOf(userId)).balance).toBe(await ledgerSum(userId));
    }
    expect(await walletOf(driver.userId)).toEqual({ balance: 71.4, heldAmount: 0 });
    expect(await db("transactions").where({ tripId: trip.id })).toHaveLength(3);
  });

  it("keeps the wallet's hold from going negative even outside the model", async () => {
    const rider = await newRider(10);

    await expect(
      db("wallets").where({ userId: rider.userId }).update({ heldAmount: -1 }),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});

describe("trips table", () => {
  it("allows one active trip per rider, commute and date, and a new one once it's cancelled", async () => {
    const { commute } = await newCommute();
    const rider = await newRider();
    const first = await insertTrip(commute, rider.userId);

    await expect(insertTrip(commute, rider.userId)).rejects.toMatchObject(UNIQUE_VIOLATION);
    await expect(insertTrip(commute, rider.userId, { status: "accepted" })).rejects.toMatchObject(
      UNIQUE_VIOLATION,
    );

    await db("trips").where({ id: first.id }).update({ status: "cancelled", cancelledBy: "rider" });
    const second = await insertTrip(commute, rider.userId);
    expect(second.status).toBe("pending");
  });

  it("refuses a boarding code another trip already has", async () => {
    const { commute } = await newCommute();
    const [one, two] = await Promise.all([newRider(), newRider()]);
    const trip = await insertTrip(commute, one.userId);

    await expect(
      insertTrip(commute, two.userId, { boardingCode: trip.boardingCode }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it.each([
    ["drop-off before pickup", { pickupProgress: 0.6, dropoffProgress: 0.4 }],
    ["pickup at the drop-off", { pickupProgress: 0.5, dropoffProgress: 0.5 }],
    ["progress past the end", { pickupProgress: 0.5, dropoffProgress: 1.2 }],
    ["an unknown status", { status: "boarding" }],
    ["a negative fare", { fare: -1 }],
  ])("refuses %s", async (_name, overrides) => {
    const { commute } = await newCommute();
    const rider = await newRider();

    await expect(insertTrip(commute, rider.userId, overrides)).rejects.toMatchObject(
      CHECK_VIOLATION,
    );
  });
});

describe("tripModel", () => {
  it("returns numbers for money and coordinates", async () => {
    const { commute } = await newCommute();
    const rider = await newRider();
    const trip = await insertTrip(commute, rider.userId);

    expect(trip).toMatchObject({
      pickupLat: commute.startLat,
      pickupProgress: 0.1,
      totalAmount: 30.04,
      heldAmount: 0,
      riderLat: null,
      boardingCode: expect.stringMatching(/^TR-[A-HJ-NP-Z2-9]{6}$/),
    });
  });

  it("counts a seat as taken only once the trip is accepted", async () => {
    const { commute } = await newCommute({ capacity: 4 });
    const riders = await Promise.all(Array.from({ length: 5 }, () => newRider()));
    const tripDate = addDays(today(), 2);

    await Promise.all(
      (["pending", "accepted", "boarded", "completed"] as const).map((status, i) =>
        insertTrip(commute, riders[i].userId, { tripDate, status }),
      ),
    );
    // Ended requests hold no seat either.
    for (const status of ["cancelled", "declined", "expired", "no_show"]) {
      await insertTrip(commute, riders[4].userId, { tripDate, status });
    }

    expect(await tripModel.seatsTaken(commute.id, tripDate)).toBe(3);
    expect(await tripModel.seatsLeft(commute.id, tripDate)).toBe(1);
    expect(await tripModel.seatsLeft(commute.id, addDays(tripDate, 1))).toBe(4);
  });

  it("expires only pending requests that are past expiresAt", async () => {
    const { commute } = await newCommute();
    const [overdue, waiting, accepted] = await Promise.all([newRider(), newRider(), newRider()]);
    const past = new Date(Date.now() - 60_000);
    const [a, b, c] = await Promise.all([
      insertTrip(commute, overdue.userId, { expiresAt: past }),
      insertTrip(commute, waiting.userId, { expiresAt: new Date(Date.now() + 600_000) }),
      insertTrip(commute, accepted.userId, { status: "accepted", expiresAt: past }),
    ]);

    expect(await tripModel.expireStale({ commuteId: commute.id })).toBe(1);

    const statuses = Object.fromEntries(
      (await db("trips").whereIn("id", [a.id, b.id, c.id])).map((t) => [t.id, t.status]),
    );
    expect(statuses).toEqual({ [a.id]: "expired", [b.id]: "pending", [c.id]: "accepted" });
    expect(await tripModel.expireStale({ commuteId: commute.id })).toBe(0);
  });
});
