import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { addDays, today } from "../src/utils/tripTime.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import {
  bookableCommute,
  bookingRider,
  insertTrip,
  walletOf,
  type TestCommute,
} from "./helpers/trips.js";

type Person = { userId: string; token: string };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let tripsReader: Awaited<ReturnType<typeof createSignedInAdmin>>; // trips: read
let userReader: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read
let moderator: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: delete
let outsider: Awaited<ReturnType<typeof createSignedInAdmin>>; // no trips or users access

// Accounts are shared across the file (each costs rate-limited sign-in calls); every test still gets its own
// trip, so what one test reviews never touches another's.
let driver: Person;
let commute: TestCommute;
let rider: Person;
let stranger: Person;
// Rated by `rider` three times, and never reviewed by anyone else.
let ratedDriver: Person;
let unratedDriver: Person;

// Every trip sits on its own date, so no two can collide on the one-active-trip-per-day rule. Completed trips are
// in the past; trips still in play are in the future, or the lazy sweep would settle them (an accepted trip long
// past its drop-off becomes a no-show, a boarded one completes).
let dayOffset = 0;
const nextDate = (status: string) =>
  addDays(today(), status === "completed" ? -(++dayOffset) : ++dayOffset);

function tripFor(commuteOf: TestCommute, riderOf: Person, status = "completed") {
  return insertTrip(commuteOf, riderOf.userId, { status, tripDate: nextDate(status) });
}

function review(
  caller: { token: string },
  tripId: string,
  body: object = { rating: 5, comment: "Great ride", tags: ["Punctual"] },
) {
  return api.post(`/trips/${tripId}/reviews`).set(auth(caller.token)).send(body);
}

async function addReview(caller: { token: string }, tripId: string, body?: object) {
  const res = await review(caller, tripId, body);
  expectStatus(res, 201);
  trackForCleanup("tripReviews", { id: res.body.data.id });
  return res.body.data as { id: string; rating: number };
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  const [admins, shared, rated, unrated, riders] = await Promise.all([
    Promise.all([
      createSignedInAdmin(superAdmin.token, { trips: { read: true } }),
      createSignedInAdmin(superAdmin.token, { users: { read: true } }),
      createSignedInAdmin(superAdmin.token, { users: { delete: true } }),
      createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
    ]),
    bookableCommute(),
    bookableCommute(),
    bookableCommute(),
    Promise.all([bookingRider(0), bookingRider(0)]),
  ]);
  [tripsReader, userReader, moderator, outsider] = admins;
  ({ driver, commute } = shared);
  ratedDriver = rated.driver;
  unratedDriver = unrated.driver;
  [rider, stranger] = riders;

  for (const stars of [5, 4, 3]) {
    const trip = await tripFor(rated.commute, rider);
    await addReview(rider, trip.id, { rating: stars });
  }
});

describe("POST /trips/:tripId/reviews", () => {
  it("lets the rider review the driver", async () => {
    const trip = await tripFor(commute, rider);

    const res = await review(rider, trip.id, {
      rating: 5,
      comment: "Great ride",
      tags: ["Punctual", "Clean Vehicle"],
    });

    expectStatus(res, 201);
    trackForCleanup("tripReviews", { id: res.body.data.id });
    expect(res.body.message).toBe("Review created successfully");
    expect(res.body.data).toMatchObject({
      tripId: trip.id,
      reviewerUserId: rider.userId,
      revieweeUserId: driver.userId,
      reviewerRole: "rider",
      rating: 5,
      comment: "Great ride",
      tags: ["Punctual", "Clean Vehicle"],
      tip: 0,
    });
  });

  it("lets the driver review the rider", async () => {
    const trip = await tripFor(commute, rider);

    const res = await review(driver, trip.id, { rating: 4 });

    expectStatus(res, 201);
    trackForCleanup("tripReviews", { id: res.body.data.id });
    expect(res.body.data).toMatchObject({
      reviewerRole: "driver",
      reviewerUserId: driver.userId,
      revieweeUserId: rider.userId,
      comment: null,
      tags: null,
    });
  });

  it("moves a tip from the rider's wallet to the driver's", async () => {
    const tipper = await bookingRider(100);
    const tipped = await bookableCommute();
    trackForCleanup("transactions", { userId: tipped.driver.userId });
    const trip = await tripFor(tipped.commute, tipper);

    await addReview(tipper, trip.id, { rating: 5, tip: 10 });

    expect(await walletOf(tipper.userId)).toEqual({ balance: 90, heldAmount: 0 });
    expect(await walletOf(tipped.driver.userId)).toEqual({ balance: 10, heldAmount: 0 });
    const rows = await db("transactions").where({ tripId: trip.id, type: "tip" });
    expect(rows.map((row) => [row.userId, row.direction, Number(row.amount)]).sort()).toEqual(
      [
        [tipped.driver.userId, "credit", 10],
        [tipper.userId, "debit", 10],
      ].sort(),
    );
  });

  it("refuses a tip the rider can't cover, and saves no review", async () => {
    const poor = await bookingRider(5);
    const trip = await tripFor(commute, poor);

    const res = await review(poor, trip.id, { rating: 5, tip: 10 });

    expectStatus(res, 409);
    expect(res.body.error).toBe("Insufficient wallet balance");
    expect(await db("tripReviews").where({ tripId: trip.id })).toHaveLength(0);
    expect(await db("transactions").where({ tripId: trip.id })).toHaveLength(0);
    expect(await walletOf(poor.userId)).toEqual({ balance: 5, heldAmount: 0 });
  });

  it("doesn't let a driver tip", async () => {
    const trip = await tripFor(commute, rider);

    const res = await review(driver, trip.id, { rating: 5, tip: 5 });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Only the rider can tip");
  });

  it.each(["pending", "accepted", "boarded", "cancelled"])(
    "refuses a trip that is %s",
    async (status) => {
      const trip = await tripFor(commute, rider, status);

      const res = await review(rider, trip.id);

      expectStatus(res, 409);
      expect(res.body.error).toBe(`Can't review a trip that is ${status}`);
    },
  );

  it("refuses a second review of the same trip by the same person", async () => {
    const trip = await tripFor(commute, rider);
    await addReview(rider, trip.id);

    const res = await review(rider, trip.id, { rating: 1 });

    expectStatus(res, 409);
    expect(res.body.error).toBe("You have already reviewed this trip");
    expect(await db("tripReviews").where({ tripId: trip.id })).toHaveLength(1);
  });

  it("doesn't let someone who wasn't on the trip review it", async () => {
    const trip = await tripFor(commute, rider);

    const res = await review(stranger, trip.id);

    expectStatus(res, 403);
    expect(res.body.error).toBe("Only the trip's rider or driver can review it");
  });

  it("404s for an unknown trip and needs a signed-in user", async () => {
    const id = randomUUID();

    const res = await review(rider, id);

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Trip not found: ${id}`);
    expectStatus(await api.post(`/trips/${id}/reviews`).send({ rating: 5 }), 401);
  });

  it.each([
    ["no rating", { comment: "hi" }],
    ["a rating of 0", { rating: 0 }],
    ["a rating of 6", { rating: 6 }],
    ["a half star", { rating: 4.5 }],
    ["a negative tip", { rating: 5, tip: -1 }],
    ["a tip with fractions of a pesewa", { rating: 5, tip: 1.005 }],
    ["more than 10 tags", { rating: 5, tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }],
  ])("rejects %s", async (_name, body) => {
    const trip = await tripFor(commute, rider);

    expectStatus(await review(rider, trip.id, body), 400);
  });
});

describe("GET /trips/:tripId/reviews", () => {
  it("shows both reviews to the trip's people and to an admin with trips: read", async () => {
    const trip = await tripFor(commute, rider);
    await addReview(rider, trip.id, { rating: 5 });
    await addReview(driver, trip.id, { rating: 4 });

    const [asRider, asDriver, asAdmin] = await Promise.all(
      [rider, driver, tripsReader].map((viewer) =>
        api.get(`/trips/${trip.id}/reviews`).set(auth(viewer.token)),
      ),
    );

    for (const res of [asRider, asDriver, asAdmin]) {
      expectStatus(res, 200);
      expect(res.body.data.map((r: { reviewerRole: string }) => r.reviewerRole)).toEqual([
        "rider",
        "driver",
      ]);
    }
  });

  it("is closed to strangers and to admins without trips: read", async () => {
    const trip = await tripFor(commute, rider);

    expectStatus(await api.get(`/trips/${trip.id}/reviews`).set(auth(stranger.token)), 403);
    const refused = await api.get(`/trips/${trip.id}/reviews`).set(auth(outsider.token));
    expectStatus(refused, 403);
    expect(refused.body.error).toBe("Missing permission: read on trips");
  });
});

describe("PATCH /reviews/:id", () => {
  it("lets the reviewer change the rating, comment and tags", async () => {
    const trip = await tripFor(commute, rider);
    const created = await addReview(rider, trip.id, { rating: 3, comment: "Okay" });

    const res = await api
      .patch(`/reviews/${created.id}`)
      .set(auth(rider.token))
      .send({ rating: 5, tags: ["Polite"] });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ rating: 5, comment: "Okay", tags: ["Polite"] });
  });

  it("doesn't let the other party, or an admin, edit it", async () => {
    const trip = await tripFor(commute, rider);
    const created = await addReview(rider, trip.id);

    const other = await api
      .patch(`/reviews/${created.id}`)
      .set(auth(driver.token))
      .send({ rating: 1 });
    const admin = await api
      .patch(`/reviews/${created.id}`)
      .set(auth(moderator.token))
      .send({ rating: 1 });

    expectStatus(other, 403);
    expect(other.body.error).toBe("Only the reviewer can edit this review");
    expectStatus(admin, 403);
  });

  it("rejects an empty body and 404s for an unknown review", async () => {
    const trip = await tripFor(commute, rider);
    const created = await addReview(rider, trip.id);

    expectStatus(await api.patch(`/reviews/${created.id}`).set(auth(rider.token)).send({}), 400);
    expectStatus(
      await api.patch(`/reviews/${randomUUID()}`).set(auth(rider.token)).send({ rating: 4 }),
      404,
    );
  });
});

describe("ratings", () => {
  it("summarises a driver's reviews, and any signed-in user may see a driver's", async () => {
    const res = await api
      .get(`/users/${ratedDriver.userId}/ratings/summary`)
      .set(auth(stranger.token));

    expectStatus(res, 200);
    expect(res.body.data).toEqual({
      userId: ratedDriver.userId,
      averageRating: 4,
      totalReviews: 3,
      breakdown: { star1: 0, star2: 0, star3: 1, star4: 1, star5: 1 },
    });
  });

  it("reports zero for a driver nobody has reviewed", async () => {
    const res = await api
      .get(`/users/${unratedDriver.userId}/ratings/summary`)
      .set(auth(unratedDriver.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ averageRating: 0, totalReviews: 0 });
  });

  it("keeps a rider's rating to the rider and admins with users: read", async () => {
    const lone = await bookingRider(0);
    const trip = await tripFor(commute, lone);
    await addReview(driver, trip.id, { rating: 2 });

    const own = await api.get(`/users/${lone.userId}/ratings/summary`).set(auth(lone.token));
    const admin = await api
      .get(`/users/${lone.userId}/ratings/summary`)
      .set(auth(userReader.token));
    const other = await api
      .get(`/users/${lone.userId}/ratings/summary`)
      .set(auth(stranger.token));

    expectStatus(own, 200);
    expect(own.body.data).toMatchObject({ averageRating: 2, totalReviews: 1 });
    expectStatus(admin, 200);
    expectStatus(other, 403);
    expect(other.body.error).toBe("Missing permission: read on users");
  });

  it("lists the reviews a user received, newest first, with the reviewer's first name", async () => {
    const res = await api
      .get(`/users/${ratedDriver.userId}/reviews`)
      .query({ limit: 2 })
      .set(auth(ratedDriver.token));

    expectStatus(res, 200);
    expect(res.body.data.items.map((r: { rating: number }) => r.rating)).toEqual([3, 4]);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 2, totalItems: 3, totalPages: 2 });
    expect(res.body.data.items[0].reviewerName).not.toContain(" ");
  });

  it("gives admins with users: read the full reviewer name, and refuses other people", async () => {
    const admin = await api
      .get(`/users/${ratedDriver.userId}/reviews`)
      .set(auth(userReader.token));
    const other = await api.get(`/users/${ratedDriver.userId}/reviews`).set(auth(stranger.token));

    expectStatus(admin, 200);
    expect(admin.body.data.items).toHaveLength(3);
    expect(admin.body.data.items[0].reviewerName).toBe(
      (await db("users").where({ id: rider.userId }).first("fullName")).fullName,
    );
    expectStatus(other, 403);
  });

  it("404s for an unknown user", async () => {
    const id = randomUUID();

    const res = await api.get(`/users/${id}/reviews`).set(auth(userReader.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`User not found: ${id}`);
  });
});

describe("DELETE /reviews/:id", () => {
  it("lets an admin with users: delete remove a review", async () => {
    const trip = await tripFor(commute, rider);
    const created = await addReview(rider, trip.id);

    const res = await api.delete(`/reviews/${created.id}`).set(auth(moderator.token));

    expectStatus(res, 200);
    expect(await db("tripReviews").where({ id: created.id })).toHaveLength(0);
  });

  it("is closed to the reviewer and to admins without users: delete", async () => {
    const trip = await tripFor(commute, rider);
    const created = await addReview(rider, trip.id);

    const own = await api.delete(`/reviews/${created.id}`).set(auth(rider.token));
    const admin = await api.delete(`/reviews/${created.id}`).set(auth(userReader.token));

    expectStatus(own, 403);
    expect(own.body.error).toBe("Missing permission: delete on users");
    expectStatus(admin, 403);
  });

  it("404s for an unknown review", async () => {
    const id = randomUUID();

    const res = await api.delete(`/reviews/${id}`).set(auth(moderator.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Review not found: ${id}`);
  });
});
