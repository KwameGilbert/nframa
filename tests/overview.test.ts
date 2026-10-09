import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { walletModel } from "../src/models/wallet.model.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin } from "./helpers/actors.js";
import { insertTrip, newCommute, newRider } from "./helpers/trips.js";

type SignedInAdmin = Awaited<ReturnType<typeof createSignedInAdmin>>;

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let viewer: SignedInAdmin; // overview: read
let outsider: SignedInAdmin; // trips: read, nothing on overview

const todayUtc = () => new Date().toISOString().slice(0, 10);

function getOverview(token: string, query: Record<string, string | number> = {}) {
  return api.get("/admin/overview").query(query).set(auth(token));
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [viewer, outsider] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { overview: { read: true } }),
    createSignedInAdmin(superAdmin.token, { trips: { read: true } }),
  ]);
});

describe("GET /admin/overview", () => {
  it("needs a token", async () => {
    expectStatus(await api.get("/admin/overview"), 401);
  });

  it("needs overview: read", async () => {
    expectStatus(await getOverview(outsider.token), 403);
  });

  it("is open to the super admin", async () => {
    expectStatus(await getOverview(superAdmin.token), 200);
  });

  it("returns every block, with 7 days of trip activity by default", async () => {
    const res = await getOverview(viewer.token);
    expectStatus(res, 200);
    const data = res.body.data;

    for (const key of [
      "activeRiders",
      "activeCarOwners",
      "tripsToday",
      "openIncidents",
      "pendingVerification",
      "openTickets",
    ]) {
      expect(Number.isInteger(data.stats[key])).toBe(true);
    }
    expect(typeof data.stats.revenue).toBe("number");

    for (const key of ["activeRiders", "activeCarOwners", "tripsToday", "revenue"]) {
      expect(data.trends[key]).toEqual({
        direction: expect.stringMatching(/^(up|down)$/),
        value: expect.stringMatching(/^([+-]\d+(\.\d)?|0)%$/),
      });
    }

    expect(data.tripActivity).toHaveLength(7);
    expect(data.tripActivity.at(-1).date).toBe(todayUtc());
    const dates = data.tripActivity.map((d: { date: string }) => d.date);
    expect([...dates].sort()).toEqual(dates);

    expect(data.verificationQueue.map((q: { label: string }) => q.label)).toEqual([
      "driver",
      "vehicle",
      "insurance",
    ]);

    expect(data.recentActions.length).toBeLessThanOrEqual(20);
    for (const action of data.recentActions) {
      expect(action.tone).toMatch(/^(success|danger)$/);
    }
  });

  it("counts a trip completed today in stats, revenue and today's activity", async () => {
    const { commute } = await newCommute();
    const rider = await newRider();
    const before = (await getOverview(viewer.token)).body.data;

    const trip = await insertTrip(commute, rider.userId, {
      status: "completed",
      completedAt: new Date(),
    });
    // Revenue comes from the ledger: completing a trip records platformFee 2.64 + bookingFee 1 for the platform.
    await db.transaction((trx) =>
      walletModel.recordPlatformIn(trx, { tripId: trip.id, type: "platformFee", amount: 3.64 }),
    );

    const after = (await getOverview(viewer.token)).body.data;
    expect(after.stats.tripsToday).toBeGreaterThanOrEqual(before.stats.tripsToday + 1);
    expect(after.stats.revenue).toBeGreaterThanOrEqual(before.stats.revenue + 3.64 - 0.001);
    expect(after.tripActivity.at(-1).completed).toBeGreaterThanOrEqual(
      before.tripActivity.at(-1).completed + 1,
    );
  });

  it("returns up to 30 days of trip activity", async () => {
    const res = await getOverview(viewer.token, { days: 30 });
    expectStatus(res, 200);
    expect(res.body.data.tripActivity).toHaveLength(30);
  });

  it.each([0, 31, "abc"])("rejects days=%s", async (days) => {
    expectStatus(await getOverview(viewer.token, { days }), 400);
  });
});
