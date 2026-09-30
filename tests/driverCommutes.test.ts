import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
  signUpDriverWithProfile,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { haversineMeters } from "../src/services/geo.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let viewer: Awaited<ReturnType<typeof createSignedInAdmin>>; // commutes: read
let manager: Awaited<ReturnType<typeof createSignedInAdmin>>; // commutes: create, update, delete
let outsider: Awaited<ReturnType<typeof createSignedInAdmin>>; // an admin with no commutes access
let driver: Awaited<ReturnType<typeof signUpDriverWithProfile>>;
let otherDriver: Awaited<ReturnType<typeof signUpDriverWithProfile>>;

async function addCommute(owner: { token: string }, body: object = data.commute()) {
  const res = await api.post("/commutes").set(auth(owner.token)).send(body);
  expectStatus(res, 201);
  trackForCleanup("driverCommutes", { id: res.body.data.id });
  return res.body.data as { id: string; userId: string };
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [viewer, manager, outsider, driver, otherDriver] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
    createSignedInAdmin(superAdmin.token, {
      commutes: { create: true, update: true, delete: true },
    }),
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    signUpDriverWithProfile(),
    signUpDriverWithProfile(),
  ]);
});

describe("POST /commutes", () => {
  it("lets a driver add their own commute", async () => {
    const commute = data.commute();

    const res = await api.post("/commutes").set(auth(driver.token)).send(commute);

    expectStatus(res, 201);
    trackForCleanup("driverCommutes", { id: res.body.data.id });
    expect(res.body.message).toBe("Commute created successfully");
    expect(res.body.data).toMatchObject({
      ...commute,
      userId: driver.userId,
      departureTime: `${commute.departureTime}:00`,
      isActive: true,
    });
  });

  it("lets an admin with commutes: create add one for a driver", async () => {
    const res = await api
      .post("/commutes")
      .set(auth(manager.token))
      .send({ ...data.commute(), userId: driver.userId });

    expectStatus(res, 201);
    trackForCleanup("driverCommutes", { id: res.body.data.id });
    expect(res.body.data.userId).toBe(driver.userId);
  });

  it("doesn't let a driver add a commute for another driver", async () => {
    const res = await api
      .post("/commutes")
      .set(auth(driver.token))
      .send({ ...data.commute(), userId: otherDriver.userId });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on commutes");
  });

  it("doesn't let an admin without commutes: create add one", async () => {
    const res = await api
      .post("/commutes")
      .set(auth(viewer.token))
      .send({ ...data.commute(), userId: driver.userId });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on commutes");
  });

  it("needs the owner to have a driver profile", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.post("/commutes").set(auth(rider.token)).send(data.commute());

    expectStatus(res, 400);
    expect(res.body.error).toBe(`No driver profile for user: ${rider.userId}`);
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.post("/commutes").send(data.commute()), 401);
  });

  it.each([
    ["a latitude past 90", { startLat: 91 }],
    ["a longitude past -180", { endLng: -181 }],
    ["a departure time that isn't a time", { departureTime: "25:00" }],
    ["a departure time without a leading zero", { departureTime: "7:30" }],
    ["no days", { recurrenceDays: [] }],
    ["a repeated day", { recurrenceDays: [1, 1] }],
    ["a day past Sunday", { recurrenceDays: [8] }],
    ["no seats", { capacity: 0 }],
    ["more than 8 seats", { capacity: 9 }],
    ["a missing address", { startAddress: undefined }],
  ])("rejects %s", async (_name, override) => {
    const res = await api
      .post("/commutes")
      .set(auth(driver.token))
      .send({ ...data.commute(), ...override });

    expectStatus(res, 400);
  });
});

// The global Google mock in tests/setup.ts: 1.3x the straight line, at 10 m/s.
function mockedRoute(c: { startLat: number; startLng: number; endLat: number; endLng: number }) {
  const distanceMeters = Math.round(
    haversineMeters({ lat: c.startLat, lng: c.startLng }, { lat: c.endLat, lng: c.endLng }) * 1.3,
  );
  return { distanceMeters, durationSeconds: Math.round(distanceMeters / 10) };
}

describe("commute route snapshot", () => {
  it("is saved on create", async () => {
    const commute = data.commute();

    const res = await api.post("/commutes").set(auth(driver.token)).send(commute);

    expectStatus(res, 201);
    trackForCleanup("driverCommutes", { id: res.body.data.id });
    expect(res.body.data).toMatchObject(mockedRoute(commute));
    expect(res.body.data.distanceMeters).toBeGreaterThan(0);
  });

  it("is recomputed from the merged coordinates when a coordinate changes", async () => {
    const created = await addCommute(driver);
    const before = (await api.get(`/commutes/${created.id}`).set(auth(driver.token))).body.data;
    const endLat = before.endLat + 0.1;

    const res = await api.patch(`/commutes/${created.id}`).set(auth(driver.token)).send({ endLat });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject(mockedRoute({ ...before, endLat }));
    expect(res.body.data.distanceMeters).not.toBe(before.distanceMeters);
  });

  it("is left alone when the update doesn't move the start or end", async () => {
    const created = await addCommute(driver);
    const before = (await api.get(`/commutes/${created.id}`).set(auth(driver.token))).body.data;

    const res = await api
      .patch(`/commutes/${created.id}`)
      .set(auth(driver.token))
      .send({ capacity: 2 });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      distanceMeters: before.distanceMeters,
      durationSeconds: before.durationSeconds,
    });
  });
});

describe("GET /commutes", () => {
  it("gives a driver only their own commutes", async () => {
    const mine = await addCommute(driver);
    const theirs = await addCommute(otherDriver);

    const res = await api.get("/commutes").set(auth(driver.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Commutes retrieved successfully");
    const ids = res.body.data.map((commute: { id: string }) => commute.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    for (const commute of res.body.data) {
      expect(commute.userId).toBe(driver.userId);
    }
  });

  it("gives an admin with commutes: read every driver's commutes", async () => {
    const [mine, theirs] = await Promise.all([addCommute(driver), addCommute(otherDriver)]);

    const res = await api.get("/commutes").set(auth(viewer.token));

    expectStatus(res, 200);
    const ids = res.body.data.map((commute: { id: string }) => commute.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, theirs.id]));
  });

  it("doesn't let an admin without commutes: read list them", async () => {
    const res = await api.get("/commutes").set(auth(outsider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on commutes");
  });

  it("gives a rider an empty list", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.get("/commutes").set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /commutes/:id", () => {
  it("lets a driver read their own commute", async () => {
    const commute = await addCommute(driver);

    const res = await api.get(`/commutes/${commute.id}`).set(auth(driver.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Commute retrieved successfully");
    expect(res.body.data).toMatchObject({ id: commute.id, userId: driver.userId });
  });

  it("lets an admin with commutes: read read anyone's", async () => {
    const commute = await addCommute(driver);

    expectStatus(await api.get(`/commutes/${commute.id}`).set(auth(viewer.token)), 200);
  });

  it("doesn't let another driver read it", async () => {
    const commute = await addCommute(driver);

    const res = await api.get(`/commutes/${commute.id}`).set(auth(otherDriver.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on commutes");
  });

  it("404s an unknown commute", async () => {
    const id = randomUUID();

    const res = await api.get(`/commutes/${id}`).set(auth(driver.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Commute not found: ${id}`);
  });

  it("rejects an id that isn't a uuid", async () => {
    expectStatus(await api.get("/commutes/not-a-uuid").set(auth(driver.token)), 400);
  });
});

describe("PATCH /commutes/:id", () => {
  it("lets a driver change their commute", async () => {
    const commute = await addCommute(driver);

    const res = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(driver.token))
      .send({ departureTime: "06:45", recurrenceDays: [2, 4], capacity: 2 });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Commute updated successfully");
    expect(res.body.data).toMatchObject({
      id: commute.id,
      userId: driver.userId,
      departureTime: "06:45:00",
      recurrenceDays: [2, 4],
      capacity: 2,
    });
  });

  it("lets a driver pause and resume a commute with isActive", async () => {
    const commute = await addCommute(driver);

    const paused = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(driver.token))
      .send({ isActive: false });
    const resumed = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(driver.token))
      .send({ isActive: true });

    expect(paused.body.data.isActive).toBe(false);
    expect(resumed.body.data.isActive).toBe(true);
  });

  it("lets an admin with commutes: update change anyone's", async () => {
    const commute = await addCommute(driver);

    const res = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(manager.token))
      .send({ capacity: 3 });

    expectStatus(res, 200);
    expect(res.body.data.capacity).toBe(3);
  });

  it("doesn't let another driver change it", async () => {
    const commute = await addCommute(driver);

    const res = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(otherDriver.token))
      .send({ capacity: 1 });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on commutes");
  });

  it("doesn't let an admin with only commutes: read change it", async () => {
    const commute = await addCommute(driver);

    const res = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(viewer.token))
      .send({ capacity: 1 });

    expectStatus(res, 403);
  });

  it("doesn't move a commute to another driver", async () => {
    const commute = await addCommute(driver);

    const res = await api
      .patch(`/commutes/${commute.id}`)
      .set(auth(driver.token))
      .send({ userId: otherDriver.userId, capacity: 2 });

    expectStatus(res, 200);
    expect(res.body.data.userId).toBe(driver.userId);
  });

  it("rejects an empty update", async () => {
    const commute = await addCommute(driver);

    const res = await api.patch(`/commutes/${commute.id}`).set(auth(driver.token)).send({});

    expectStatus(res, 400);
  });

  it("404s an unknown commute", async () => {
    const res = await api
      .patch(`/commutes/${randomUUID()}`)
      .set(auth(driver.token))
      .send({ capacity: 2 });

    expectStatus(res, 404);
  });
});

describe("DELETE /commutes/:id", () => {
  it("lets a driver delete their own commute", async () => {
    const commute = await addCommute(driver);

    const res = await api.delete(`/commutes/${commute.id}`).set(auth(driver.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Commute deleted successfully");
    expectStatus(await api.get(`/commutes/${commute.id}`).set(auth(driver.token)), 404);
  });

  it("lets an admin with commutes: delete delete anyone's", async () => {
    const commute = await addCommute(driver);

    expectStatus(await api.delete(`/commutes/${commute.id}`).set(auth(manager.token)), 200);
  });

  it("doesn't let another driver delete it", async () => {
    const commute = await addCommute(driver);

    const res = await api.delete(`/commutes/${commute.id}`).set(auth(otherDriver.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on commutes");
    expectStatus(await api.get(`/commutes/${commute.id}`).set(auth(driver.token)), 200);
  });

  it("doesn't let an admin with only commutes: read delete it", async () => {
    const commute = await addCommute(driver);

    expectStatus(await api.delete(`/commutes/${commute.id}`).set(auth(viewer.token)), 403);
  });
});

describe("activity log", () => {
  it("records a commute's creation, change and deletion", async () => {
    // Not 2 seats, which is what the update below sets: an unchanged value wouldn't be a changed field.
    const commute = await addCommute(driver, { ...data.commute(), capacity: 4 });
    expectStatus(
      await api.patch(`/commutes/${commute.id}`).set(auth(driver.token)).send({ capacity: 2 }),
      200,
    );
    expectStatus(await api.delete(`/commutes/${commute.id}`).set(auth(driver.token)), 200);
    await flushActivityLogs();

    const res = await api
      .get("/admin/activity-logs")
      .query({ targetType: "commute", targetId: commute.id })
      .set(auth(superAdmin.token));

    expectStatus(res, 200);
    const entries: { action: string; module: string; changedFields: string[] | null }[] =
      res.body.data.items;
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      "commute.create",
      "commute.delete",
      "commute.update",
    ]);
    expect(entries.every((entry) => entry.module === "commutes")).toBe(true);
    expect(entries.find((entry) => entry.action === "commute.update")?.changedFields).toContain(
      "capacity",
    );
  });
});
