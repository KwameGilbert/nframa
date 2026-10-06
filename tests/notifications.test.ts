import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { deliverNotification } from "../src/services/notification.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createPhoneAccount, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { seedNotification } from "./helpers/push.js";

// The inbox API: GET /notifications, POST /notifications/:id/read, POST /notifications/read-all and
// DELETE /notifications/:id. Rows are seeded straight to the DB; each test has its own accounts.

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let refusals: Awaited<ReturnType<typeof signUpByPhone>>; // only ever sends requests that are refused

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const list = (token: string, query = "") => api.get(`/notifications${query}`).set(auth(token));
const read = (token: string, id: string) => api.post(`/notifications/${id}/read`).set(auth(token));
const remove = (token: string, id: string) => api.delete(`/notifications/${id}`).set(auth(token));
const ids = (res: { body: { data: { items: { id: string }[] } } }) =>
  res.body.data.items.map((item) => item.id);

const rowOf = (id: string) => db("notifications").where({ id }).first();

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  refusals = await signUpByPhone("rider");
});

describe("GET /notifications", () => {
  it("lists mine newest first, paginated, with the unread count of the whole inbox", async () => {
    const user = await signUpByPhone("rider");
    const [oldest, middle, newest] = await Promise.all([
      seedNotification(user.userId, { createdAt: minutesAgo(30), readAt: minutesAgo(25) }),
      seedNotification(user.userId, { createdAt: minutesAgo(20) }),
      seedNotification(user.userId, { createdAt: minutesAgo(10) }),
    ]);

    const first = await list(user.token, "?limit=2");
    const second = await list(user.token, "?limit=2&page=2");

    expectStatus(first, 200);
    expect(first.body.message).toBe("Notifications retrieved successfully");
    expect(ids(first)).toEqual([newest.id, middle.id]);
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 2, totalItems: 3, totalPages: 2 });
    expect(first.body.data.unreadCount).toBe(2);
    expect(Object.keys(first.body.data.items[0]).sort()).toEqual([
      "body",
      "createdAt",
      "data",
      "id",
      "readAt",
      "title",
      "type",
    ]);
    expectStatus(second, 200);
    expect(ids(second)).toEqual([oldest.id]);
    expect(second.body.data.items[0].readAt).not.toBeNull();
    expect(second.body.data.unreadCount).toBe(2);

    const defaults = await list(user.token);
    expect(defaults.body.data.pagination).toMatchObject({ page: 1, limit: 20 });
  });

  it("shows what the dispatcher delivered", async () => {
    const user = await signUpByPhone("rider");
    const tripId = randomUUID();

    await deliverNotification(user.userId, "trip.accepted", {
      title: "Trip accepted",
      body: "Your driver accepted your trip for Mon 5 Oct, 07:30.",
      data: { tripId },
    });
    const res = await list(user.token);

    expectStatus(res, 200);
    expect(res.body.data.items).toMatchObject([
      { type: "trip.accepted", title: "Trip accepted", data: { tripId }, readAt: null },
    ]);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it("filters by unread (true and false) and by type", async () => {
    const user = await signUpByPhone("driver");
    const [done, accepted, cancelled] = await Promise.all([
      seedNotification(user.userId, { createdAt: minutesAgo(30), readAt: minutesAgo(29) }),
      seedNotification(user.userId, { createdAt: minutesAgo(20) }),
      seedNotification(user.userId, {
        createdAt: minutesAgo(10),
        type: "trip.cancelled",
        title: "Trip cancelled",
        body: "The rider cancelled the trip.",
      }),
    ]);

    const unread = await list(user.token, "?unread=true");
    const alreadyRead = await list(user.token, "?unread=false");
    const byType = await list(user.token, "?type=trip.cancelled");
    const both = await list(user.token, "?unread=true&type=trip.accepted");

    expect(ids(unread)).toEqual([cancelled.id, accepted.id]);
    expect(ids(alreadyRead)).toEqual([done.id]);
    expect(ids(byType)).toEqual([cancelled.id]);
    expect(ids(both)).toEqual([accepted.id]);
    expect(both.body.data.pagination.totalItems).toBe(1);
    expect(both.body.data.unreadCount).toBe(2);
  });

  it("only shows the caller's own notifications", async () => {
    const user = await signUpByPhone("rider");
    const other = await createPhoneAccount(superAdmin.token, "rider");
    const [mine] = await Promise.all([
      seedNotification(user.userId),
      seedNotification(other.id),
      seedNotification(other.id),
    ]);

    const res = await list(user.token);

    expect(ids(res)).toEqual([mine.id]);
    expect(res.body.data.pagination.totalItems).toBe(1);
    expect(res.body.data.unreadCount).toBe(1);
  });
});

describe("POST /notifications/:id/read", () => {
  it("marks one read, idempotently, keeping the first readAt", async () => {
    const user = await signUpByPhone("rider");
    const [target] = await Promise.all([
      seedNotification(user.userId),
      seedNotification(user.userId),
    ]);

    const first = await read(user.token, target.id);
    const again = await read(user.token, target.id);

    expectStatus(first, 200);
    expect(first.body.message).toBe("Notification marked as read");
    expect(first.body.data.notification).toMatchObject({ id: target.id, type: target.type });
    expect(first.body.data.notification).not.toHaveProperty("userId");
    expect(first.body.data.notification.readAt).not.toBeNull();
    expect(first.body.data.unreadCount).toBe(1);
    expectStatus(again, 200);
    expect(again.body.data.notification.readAt).toBe(first.body.data.notification.readAt);
    expect(again.body.data.unreadCount).toBe(1);
    expect((await rowOf(target.id)).readAt.toISOString()).toBe(first.body.data.notification.readAt);
  });

  it("answers 404 for another account's notification, on read and on delete, and leaves it alone", async () => {
    const user = await signUpByPhone("driver");
    const other = await createPhoneAccount(superAdmin.token, "rider");
    const theirs = await seedNotification(other.id);
    const missing = randomUUID();

    expectError(await read(user.token, theirs.id), 404, `Notification not found: ${theirs.id}`);
    expectError(await remove(user.token, theirs.id), 404, `Notification not found: ${theirs.id}`);
    expectError(await read(user.token, missing), 404, `Notification not found: ${missing}`);

    expect(await rowOf(theirs.id)).toMatchObject({ id: theirs.id, readAt: null });
  });
});

describe("POST /notifications/read-all", () => {
  it("marks all of mine read and nobody else's, keeping readAt on ones already read", async () => {
    const user = await signUpByPhone("rider");
    const other = await createPhoneAccount(superAdmin.token, "rider");
    const earlier = minutesAgo(5);
    const [alreadyRead, , , theirs] = await Promise.all([
      seedNotification(user.userId, { readAt: earlier }),
      seedNotification(user.userId),
      seedNotification(user.userId),
      seedNotification(other.id),
    ]);

    const res = await api.post("/notifications/read-all").set(auth(user.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("All notifications marked as read");
    expect(res.body.data).toEqual({ updatedCount: 2, unreadCount: 0 });
    expect((await list(user.token, "?unread=true")).body.data.items).toEqual([]);
    expect((await rowOf(alreadyRead.id)).readAt.getTime()).toBe(earlier.getTime());
    expect(await rowOf(theirs.id)).toMatchObject({ readAt: null });

    const again = await api.post("/notifications/read-all").set(auth(user.token));
    expect(again.body.data).toEqual({ updatedCount: 0, unreadCount: 0 });
  });
});

describe("DELETE /notifications/:id", () => {
  it("deletes one of mine, then answers 404 for it", async () => {
    const user = await signUpByPhone("driver");
    const [target] = await Promise.all([
      seedNotification(user.userId),
      seedNotification(user.userId),
    ]);

    const res = await remove(user.token, target.id);

    expectStatus(res, 200);
    expect(res.body.message).toBe("Notification deleted successfully");
    expect(res.body.data).toEqual({ unreadCount: 1 });
    expect(await rowOf(target.id)).toBeUndefined();
    expectError(await remove(user.token, target.id), 404, `Notification not found: ${target.id}`);
    expectError(await read(user.token, target.id), 404, `Notification not found: ${target.id}`);
  });
});

describe("validation and authentication", () => {
  it.each([
    ["?page=0", "page: Too small: expected number to be >=1"],
    ["?limit=0", "limit: Too small: expected number to be >=1"],
    ["?limit=51", "limit: Too big: expected number to be <=50"],
    ["?unread=yes", 'unread: Invalid option: expected one of "true"|"false"'],
    ["?unread=1", 'unread: Invalid option: expected one of "true"|"false"'],
  ])("refuses %s with 400", async (query, error) => {
    expectError(await list(refusals.token, query), 400, error);
  });

  it.each(["trip.unknown", "trip.driverArrived", "sos.deskAlert", "report.deskUrgent"])(
    "refuses type=%s (unknown or push-only, never in the inbox) with 400",
    async (type) => {
      const res = await list(refusals.token, `?type=${type}`);

      expectStatus(res, 400);
      expect(res.body.error).toMatch(/^type: Invalid option: expected one of "trip.requested"\|/);
      expect(res.body.error).toContain('"trip.accepted"');
      expect(res.body.error).not.toContain(`"${type}"`);
    },
  );

  it("refuses an id that isn't a uuid with 400", async () => {
    expectError(await read(refusals.token, "not-a-uuid"), 400, "id: Invalid UUID");
    expectError(await remove(refusals.token, "not-a-uuid"), 400, "id: Invalid UUID");
  });

  it.each([
    ["get", "/notifications"],
    ["post", "/notifications/read-all"],
    ["post", `/notifications/${randomUUID()}/read`],
    ["delete", `/notifications/${randomUUID()}`],
  ] as const)("%s %s needs an access token", async (method, path) => {
    expectError(await api[method](path), 401, "Missing or invalid Authorization header");
    expectError(
      await api[method](path).set(auth("not-a-jwt")),
      401,
      "Invalid or expired access token",
    );
  });
});
