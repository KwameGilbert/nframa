import db from "../../src/database/knex.js";
import { walletModel } from "../../src/models/wallet.model.js";
import { tripModel, type Trip } from "../../src/models/trip.model.js";
import { generateCode } from "../../src/utils/code.js";
import { addDays, departureAt, today } from "../../src/utils/tripTime.js";
import { expect } from "vitest";
import { api, auth, expectStatus } from "./api.js";
import { signUpByPhone, signUpDriverWithProfile } from "./actors.js";
import { trackForCleanup } from "./cleanup.js";
import * as data from "./data.js";
import { newVehicle } from "./unique.js";

// Accounts, commutes and trips for the trip tests. insertTrip builds a trip straight in the database (for states
// no route reaches yet); the booking helpers go through the API.

// An account whose wallet and ledger are cleaned up with it.
function withMoneyCleanup<T extends { userId: string }>(account: T) {
  trackForCleanup("transactions", { userId: account.userId });
  trackForCleanup("wallets", { userId: account.userId });
  return account;
}

export async function newRider(funds = 0) {
  const rider = withMoneyCleanup(await signUpByPhone("rider"));
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
  recurrenceDays: number[];
  capacity: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export async function newCommute(overrides: Partial<ReturnType<typeof data.commute>> = {}) {
  const driver = withMoneyCleanup(await signUpDriverWithProfile());
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

export async function walletOf(userId: string) {
  const wallet = await db("wallets").where({ userId }).first();
  return { balance: Number(wallet?.balance ?? 0), heldAmount: Number(wallet?.heldAmount ?? 0) };
}

// The invariant hold/capture/release keep: what a rider's wallet holds is exactly what their accepted trips hold.
export async function expectHoldsMatchTrips(userId: string) {
  const [{ sum }] = await db("trips")
    .where({ riderUserId: userId, status: "accepted" })
    .select(db.raw(`coalesce(sum("heldAmount"), 0) as sum`));
  expect((await walletOf(userId)).heldAmount).toBe(Number(sum));
}

export const tomorrow = () => addDays(today(), 1);
export const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

// A fixed Accra route, Accra Mall to Oxford Street, Osu (about 7.4 km south).
export const ACCRA_ROUTE = {
  startAddress: "Accra Mall, Tetteh Quarshie, Accra",
  startLat: 5.6224,
  startLng: -0.1737,
  endAddress: "Oxford Street, Osu, Accra",
  endLat: 5.556,
  endLng: -0.182,
};

type CommuteFields = Partial<ReturnType<typeof data.commute>>;

// The point a fraction of the way along a commute's start-to-end line.
export function along(commute: TestCommute, fraction: number, address = "Roadside stop, Accra") {
  return {
    address,
    lat: Number((commute.startLat + (commute.endLat - commute.startLat) * fraction).toFixed(6)),
    lng: Number((commute.startLng + (commute.endLng - commute.startLng) * fraction).toFixed(6)),
  };
}

// Another commute for a driver who already has one: every day of the week on the Accra route unless overridden.
export async function addCommute(driver: { token: string }, fields: CommuteFields = {}) {
  const res = await api
    .post("/commutes")
    .set(auth(driver.token))
    .send({
      ...data.commute(),
      ...ACCRA_ROUTE,
      recurrenceDays: ALL_WEEK,
      departureTime: "07:30",
      capacity: 3,
      ...fields,
    });
  expectStatus(res, 201);
  trackForCleanup("driverCommutes", { id: res.body.data.id });
  return res.body.data as TestCommute;
}

// An approved driver with a vehicle and a commute riders can book: every day of the week, on the Accra route
// unless overridden. Book it for tomorrow() so the time of day never matters.
export async function bookableCommute({
  autoAccept = false,
  approved = true,
  ...fields
}: CommuteFields & { autoAccept?: boolean; approved?: boolean } = {}) {
  const driver = withMoneyCleanup(await signUpDriverWithProfile());
  trackForCleanup("trips", { driverUserId: driver.userId });
  const vehicle = await api
    .post("/vehicles")
    .set(auth(driver.token))
    .send(await newVehicle(driver.userId));
  expectStatus(vehicle, 201);
  trackForCleanup("vehicles", { id: vehicle.body.data.id });
  await db("carOwnerProfiles")
    .where({ userId: driver.userId })
    .update({
      verificationStatus: approved ? "approved" : "pending",
      autoAcceptBookings: autoAccept,
    });

  const commute = await addCommute(driver, fields);
  return { driver, commute, vehicle: vehicle.body.data as { plate: string } };
}

// A rider with a rider profile and funds in their wallet, ready to book.
export async function bookingRider(funds = 500) {
  const rider = await newRider(funds);
  trackForCleanup("trips", { riderUserId: rider.userId });
  const res = await api.post("/rider").set(auth(rider.token)).send({ userId: rider.userId });
  expectStatus(res, 201);
  trackForCleanup("riderProfiles", { userId: rider.userId });
  return rider;
}

// POST /trips from 20% to 80% of the way along the commute, tomorrow, unless overridden.
export function requestTrip(
  rider: { token: string },
  commute: TestCommute,
  body: Record<string, unknown> = {},
) {
  return api
    .post("/trips")
    .set(auth(rider.token))
    .send({
      commuteId: commute.id,
      tripDate: tomorrow(),
      pickup: along(commute, 0.2, "Airport Junction, Accra"),
      dropoff: along(commute, 0.8, "Danquah Circle, Osu, Accra"),
      ...body,
    });
}
