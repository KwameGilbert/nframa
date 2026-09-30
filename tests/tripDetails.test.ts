import { describe, expect, it } from "vitest";
import type { Response } from "supertest";
import { tripModel } from "../src/models/trip.model.js";
import { emitToUser } from "../src/services/socket.service.js";
import { addDays, today } from "../src/utils/tripTime.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin } from "./helpers/actors.js";
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

function viewTrip(viewer: { token: string }, id: string) {
  return api.get(`/trips/${id}`).set(auth(viewer.token));
}

function cancel(viewer: { token: string }, id: string, body?: object) {
  const req = api.post(`/trips/${id}/cancel`).set(auth(viewer.token));
  return body ? req.send(body) : req;
}

function listTrips(viewer: { token: string }, query: Record<string, unknown>) {
  return api.get("/trips").set(auth(viewer.token)).query(query);
}

const ids = (res: Response) => res.body.data.items.map((item: { id: string }) => item.id);

async function booked(rider: { token: string }, commute: TestCommute, body = {}) {
  const res = await requestTrip(rider, commute, body);
  expectStatus(res, 201);
  return res.body.data;
}

describe("GET /trips/:id", () => {
  it("shows each viewer only what they may see, and the run's stops in route order", async () => {
    const { driver, commute, vehicle } = await bookableCommute();
    const [ama, kofi, stranger, superAdmin] = await Promise.all([
      bookingRider(200),
      bookingRider(200),
      bookingRider(0),
      loginAsSuperAdmin(),
    ]);
    const admin = await createSignedInAdmin(superAdmin.token, { trips: { read: true } });
    const mine = await booked(ama, commute, {
      pickup: along(commute, 0.2),
      dropoff: along(commute, 0.6),
    });
    const theirs = await booked(kofi, commute, {
      pickup: along(commute, 0.4),
      dropoff: along(commute, 0.9),
    });

    // Pending: the rider has their code, but no phone or plate yet, and nobody is confirmed on the run: the only
    // stops are the rider's own.
    const pending = await viewTrip(ama, mine.id);
    expectStatus(pending, 200);
    expect(pending.body.data).toMatchObject({
      status: "pending",
      boardingCode: mine.boardingCode,
      driver: { fullName: driver.fullName, phone: null },
      vehicle: { plate: null },
      otherCommuters: [],
      stops: [
        { type: "pickup", isYou: true, scheduledAt: mine.scheduledPickupAt },
        { type: "dropoff", isYou: true, scheduledAt: mine.scheduledDropoffAt },
      ],
      seatsLeft: 3,
    });
    expect(mine.boardingCode).toMatch(/^TR-/);

    await tripModel.acceptWithHold(mine.id);
    await tripModel.acceptWithHold(theirs.id);

    const accepted = await viewTrip(ama, mine.id);
    expectStatus(accepted, 200);
    const trip = accepted.body.data;
    expect(trip).toMatchObject({
      status: "accepted",
      heldAmount: mine.totalAmount,
      boardingCode: mine.boardingCode,
      driver: { phone: `${driver.phoneCountryCode}${driver.phoneNumber}` },
      vehicle: { plate: vehicle.plate },
      seatsLeft: 1,
      otherCommuters: [{ firstName: kofi.fullName.split(" ")[0], profilePicture: null }],
      commute: { startAddress: commute.startAddress, departureAt: `${tomorrow()}T07:30:00.000Z` },
    });
    expect(
      trip.stops.map((s: { type: string; isYou: boolean; scheduledAt: string }) => [
        s.type,
        s.isYou,
        s.scheduledAt,
      ]),
    ).toEqual([
      ["pickup", true, mine.scheduledPickupAt],
      ["pickup", false, theirs.scheduledPickupAt],
      ["dropoff", true, mine.scheduledDropoffAt],
      ["dropoff", false, theirs.scheduledDropoffAt],
    ]);
    // Other riders are a first name and a photo: no full name, id, or code.
    for (const secret of [kofi.fullName, kofi.userId, theirs.boardingCode]) {
      expect(JSON.stringify(trip)).not.toContain(secret);
    }

    // The driver never sees the code; the rider's view is the only one with the driver's phone.
    const driverView = await viewTrip(driver, mine.id);
    expectStatus(driverView, 200);
    expect(driverView.body.data).toMatchObject({
      boardingCode: null,
      driver: { phone: null },
      vehicle: { plate: vehicle.plate },
    });

    expectError(await viewTrip(stranger, mine.id), 403, "Missing permission: read on trips");
    const adminView = await viewTrip(admin, mine.id);
    expectStatus(adminView, 200);
    expect(adminView.body.data).toMatchObject({ boardingCode: null, driver: { phone: null } });

    expect(await walletOf(ama.userId)).toEqual({ balance: 200, heldAmount: mine.totalAmount });
    await expectHoldsMatchTrips(ama.userId);
    await expectHoldsMatchTrips(kofi.userId);
  });

  it("shows a rider whose trip isn't confirmed no other riders, before or after cancelling", async () => {
    const { commute } = await bookableCommute();
    const [ama, kofi] = await Promise.all([bookingRider(200), bookingRider(200)]);
    const theirs = await booked(kofi, commute, {
      pickup: along(commute, 0.3, "37 Military Hospital, Accra"),
      dropoff: along(commute, 0.9, "Oxford Street, Osu, Accra"),
    });
    await tripModel.acceptWithHold(theirs.id);

    const requested = await requestTrip(ama, commute);
    expectStatus(requested, 201);
    const mine = requested.body.data;
    const cancelled = await cancel(ama, mine.id);
    expectStatus(cancelled, 200);

    for (const view of [mine, (await viewTrip(ama, mine.id)).body.data, cancelled.body.data]) {
      expect(view.otherCommuters).toEqual([]);
      expect(
        view.stops.map((stop: { type: string; isYou: boolean }) => [stop.type, stop.isYou]),
      ).toEqual([
        ["pickup", true],
        ["dropoff", true],
      ]);
      for (const secret of [
        "37 Military Hospital",
        theirs.pickup.lat,
        kofi.fullName.split(" ")[0],
      ]) {
        expect(JSON.stringify(view.stops)).not.toContain(String(secret));
      }
    }
  });

  it("answers 404 for a trip that doesn't exist", async () => {
    const rider = await bookingRider(0);
    const id = "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60";
    expectError(await viewTrip(rider, id), 404, `Trip not found: ${id}`);
  });
});

describe("tripModel.acceptWithHold", () => {
  it("accepts only a pending, unexpired request the rider can pay for", async () => {
    const { commute } = await bookableCommute();
    const rider = await bookingRider(10);
    const expired = await insertTrip(commute, rider.userId, {
      tripDate: tomorrow(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const tooDear = await insertTrip(commute, rider.userId, { tripDate: addDays(tomorrow(), 1) });
    const cancelled = await insertTrip(commute, rider.userId, {
      tripDate: addDays(tomorrow(), 2),
      status: "cancelled",
    });

    await expect(tripModel.acceptWithHold(expired.id)).rejects.toMatchObject({
      statusCode: 409,
      message: "Can't accept a trip that is expired",
    });
    await expect(tripModel.acceptWithHold(tooDear.id)).rejects.toMatchObject({
      statusCode: 409,
      message: "The rider's wallet no longer covers this trip",
    });
    await expect(tripModel.acceptWithHold(cancelled.id)).rejects.toMatchObject({
      statusCode: 409,
      message: "Can't accept a trip that is cancelled",
    });

    expect((await tripModel.findById(tooDear.id))?.status).toBe("pending");
    expect(await walletOf(rider.userId)).toEqual({ balance: 10, heldAmount: 0 });
    expect(await tripModel.seatsLeft(commute.id, addDays(tomorrow(), 1))).toBe(3);
  });
});

describe("POST /trips/:id/cancel", () => {
  it("lets the rider cancel an accepted trip, freeing the seat and the held money", async () => {
    const { driver, commute } = await bookableCommute({ autoAccept: true, capacity: 2 });
    const rider = await bookingRider(200);
    const trip = await booked(rider, commute);
    expect(await tripModel.seatsLeft(commute.id, tomorrow())).toBe(1);

    const res = await cancel(rider, trip.id, { reason: "Plans changed" });
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      status: "cancelled",
      cancelledBy: "rider",
      cancellationReason: "Plans changed",
      heldAmount: 0,
      seatsLeft: 2,
    });
    expect(res.body.data.cancelledAt).not.toBeNull();
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });
    await expectHoldsMatchTrips(rider.userId);
    expect(emitToUser).toHaveBeenCalledWith(driver.userId, "trip:cancelled", {
      tripId: trip.id,
      commuteId: commute.id,
      tripDate: tomorrow(),
      status: "cancelled",
      cancelledBy: "rider",
      reason: "Plans changed",
    });

    expectError(await cancel(rider, trip.id), 409, "Can't cancel a trip that is cancelled");
    // A cancelled trip no longer blocks booking the same commute again.
    expectStatus(await requestTrip(rider, commute), 201);
  });

  it("lets the driver cancel an accepted trip, but only its rider or driver may cancel", async () => {
    const { driver, commute } = await bookableCommute({ autoAccept: true });
    const [rider, stranger] = await Promise.all([bookingRider(200), bookingRider(200)]);
    const trip = await booked(rider, commute);

    expectError(
      await cancel(stranger, trip.id),
      403,
      "Only the trip's rider or driver can cancel it",
    );

    const res = await cancel(driver, trip.id);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "cancelled", cancelledBy: "driver" });
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });
    await expectHoldsMatchTrips(rider.userId);
    expect(emitToUser).toHaveBeenCalledWith(
      rider.userId,
      "trip:cancelled",
      expect.objectContaining({ tripId: trip.id, cancelledBy: "driver", reason: null }),
    );
  });

  it("refuses the driver a pending request, and anyone a boarded trip", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    const pending = await booked(rider, commute);
    const boarded = await insertTrip(commute, rider.userId, {
      tripDate: addDays(tomorrow(), 1),
      status: "boarded",
    });

    expectError(await cancel(driver, pending.id), 409, "Can't cancel a trip that is pending");
    const res = await cancel(rider, pending.id);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "cancelled", cancelledBy: "rider" });
    expect(await walletOf(rider.userId)).toEqual({ balance: 200, heldAmount: 0 });

    expectError(await cancel(rider, boarded.id), 409, "Can't cancel a trip that is boarded");
    expectError(await cancel(driver, boarded.id), 409, "Can't cancel a trip that is boarded");
  });
});

describe("DELETE /commutes/:id", () => {
  it("refuses to delete a commute that has trips", async () => {
    const { driver, commute } = await bookableCommute();
    const rider = await bookingRider(200);
    await booked(rider, commute);

    expectError(
      await api.delete(`/commutes/${commute.id}`).set(auth(driver.token)),
      409,
      "This commute has trips: pause it instead of deleting it",
    );
    expectStatus(await api.get(`/commutes/${commute.id}`).set(auth(driver.token)), 200);
  });
});

describe("GET /trips", () => {
  it("lists a rider's and a driver's upcoming and past trips", async () => {
    const { driver, commute } = await bookableCommute({ autoAccept: true });
    const evening = await addCommute(driver, { departureTime: "18:00" });
    const [rider, superAdmin] = await Promise.all([bookingRider(300), loginAsSuperAdmin()]);
    const later = await booked(rider, evening);
    const soon = await booked(rider, commute);
    const done = await insertTrip(commute, rider.userId, {
      tripDate: addDays(today(), -2),
      status: "completed",
    });
    // Pending past its expiry: listing expires it, so it's past.
    const stale = await insertTrip(commute, rider.userId, {
      tripDate: addDays(tomorrow(), 1),
      expiresAt: new Date(Date.now() - 1000),
    });
    const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    // On board, even past its scheduled drop-off: still upcoming until it's completed.
    const onBoard = await insertTrip(commute, rider.userId, {
      tripDate: today(),
      status: "boarded",
      scheduledPickupAt: minutesFromNow(-120),
      scheduledDropoffAt: minutesFromNow(-60),
    });
    // Accepted, pickup time passed but drop-off still ahead: upcoming.
    const underway = await insertTrip(evening, rider.userId, {
      tripDate: today(),
      status: "accepted",
      scheduledPickupAt: minutesFromNow(-10),
      scheduledDropoffAt: minutesFromNow(20),
    });
    // Accepted, but its drop-off time has passed: past.
    const overdue = await insertTrip(commute, rider.userId, {
      tripDate: addDays(today(), -1),
      status: "accepted",
      scheduledPickupAt: minutesFromNow(-24 * 60),
      scheduledDropoffAt: minutesFromNow(-24 * 60 + 20),
    });

    for (const viewer of [rider, driver]) {
      const upcoming = await listTrips(viewer, {});
      expectStatus(upcoming, 200);
      expect(ids(upcoming)).toEqual([onBoard.id, underway.id, soon.id, later.id]);
      const past = await listTrips(viewer, { when: "past" });
      expect(ids(past)).toEqual([stale.id, overdue.id, done.id]);
    }

    const page = await listTrips(rider, { limit: 1, page: 2 });
    expect(ids(page)).toEqual([underway.id]);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 1, totalItems: 4, totalPages: 4 });
    expect(ids(await listTrips(rider, { when: "past", status: "expired" }))).toEqual([stale.id]);

    const item = (await listTrips(rider, {})).body.data.items.find(
      (trip: { id: string }) => trip.id === soon.id,
    );
    expect(item).toMatchObject({
      status: "accepted",
      commute: { startAddress: commute.startAddress, departureAt: `${tomorrow()}T07:30:00.000Z` },
      driver: { fullName: driver.fullName },
      rider: { firstName: rider.fullName.split(" ")[0] },
    });
    expect(item.boardingCode).toBeUndefined();

    expectError(await listTrips(superAdmin, {}), 403, "Only riders and drivers have trips");
  });
});
