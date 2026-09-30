import db from "../../src/database/knex.js";
import { walletModel } from "../../src/models/wallet.model.js";
import { tripModel, type Trip } from "../../src/models/trip.model.js";
import { generateCode } from "../../src/utils/code.js";
import { departureAt, today } from "../../src/utils/tripTime.js";
import { api, auth, expectStatus } from "./api.js";
import { signUpByPhone, signUpDriverWithProfile } from "./actors.js";
import { trackForCleanup } from "./cleanup.js";
import * as data from "./data.js";

// Trips have no routes yet, so these build them straight in the database, next to real accounts and commutes.

// An account whose wallet and ledger are cleaned up with it.
function withMoneyCleanup<T extends { userId: string }>(account: T) {
  trackForCleanup("transactions", { userId: account.userId });
  trackForCleanup("wallets", { userId: account.userId });
  return account;
}

export async function newRider(funds = 0) {
  const rider = await withMoneyCleanup(await signUpByPhone("rider"));
  if (funds > 0) await fund(rider.userId, funds);
  return rider;
}

function fund(userId: string, amount: number) {
  return walletModel.record({ userId, type: "topup", direction: "credit", amount });
}

export interface TestCommute {
  id: string;
  userId: string;
  startAddress: string;
  startLat: number;
  startLng: number;
  endAddress: string;
  endLat: number;
  endLng: number;
  departureTime: string;
  capacity: number;
}

export async function newCommute(overrides: Partial<ReturnType<typeof data.commute>> = {}) {
  const driver = await withMoneyCleanup(await signUpDriverWithProfile());
  const res = await api
    .post("/commutes")
    .set(auth(driver.token))
    .send({ ...data.commute(), ...overrides });
  expectStatus(res, 201);
  trackForCleanup("driverCommutes", { id: res.body.data.id });
  return { driver, commute: res.body.data as TestCommute };
}

// A pending trip from near the commute's start to near its end, today, priced like a short Accra ride.
export async function insertTrip(
  commute: TestCommute,
  riderUserId: string,
  overrides: Partial<Record<keyof Trip, unknown>> = {},
): Promise<Trip> {
  const tripDate = (overrides.tripDate as string | undefined) ?? today();
  const scheduledPickupAt = departureAt(tripDate, commute.departureTime);
  const [row] = await db("trips")
    .insert({
      commuteId: commute.id,
      riderUserId,
      driverUserId: commute.userId,
      tripDate,
      pickupAddress: commute.startAddress,
      pickupLat: commute.startLat,
      pickupLng: commute.startLng,
      dropoffAddress: commute.endAddress,
      dropoffLat: commute.endLat,
      dropoffLng: commute.endLng,
      pickupProgress: 0.1,
      dropoffProgress: 0.9,
      distanceMeters: 6200,
      durationSeconds: 1080,
      scheduledPickupAt,
      scheduledDropoffAt: new Date(scheduledPickupAt.getTime() + 1080 * 1000),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      fare: 26.4,
      platformFee: 2.64,
      bookingFee: 1,
      totalAmount: 30.04,
      driverEarnings: 26.4,
      fareBreakdown: JSON.stringify({ baseFare: 5, distance: 12.4, time: 9 }),
      boardingCode: generateCode("TR"),
      ...overrides,
    })
    .returning("id");
  trackForCleanup("trips", { id: row.id });
  return (await tripModel.findById(row.id))!;
}
