import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { smsSegments } from "../src/utils/sms.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import db from "../src/database/knex.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let studio: Awaited<ReturnType<typeof createSignedInAdmin>>;

const ALL = { read: true, create: true, update: true, delete: true };

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  studio = await createSignedInAdmin(superAdmin.token, { broadcasts: ALL });
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: `Accra-Tema route diversion ${randomUUID().slice(0, 8)}`,
    body: "Monday's morning commutes between Accra and Tema will use the Spintex Road because of road works.",
    audience: "drivers",
    channels: ["inApp", "push"],
    ...overrides,
  };
}

async function createDraft(overrides: Record<string, unknown> = {}) {
  const res = await api.post("/admin/broadcasts").set(auth(studio.token)).send(draft(overrides));
  expectStatus(res, 201);
  trackForCleanup("broadcasts", { id: res.body.data.id });
  return res.body.data;
}

function inMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function scheduled(overrides: Record<string, unknown> = {}) {
  const broadcast = await createDraft(overrides);
  const res = await api
    .post(`/admin/broadcasts/${broadcast.id}/schedule`)
    .set(auth(studio.token))
    .send({ scheduledFor: inMinutes(60) });
  expectStatus(res, 200);
  return res.body.data;
}

describe("smsSegments", () => {
  it.each([
    ["160 plain characters", "a".repeat(160), 1],
    ["161 plain characters", "a".repeat(161), 2],
    ["459 plain characters", "a".repeat(459), 3],
    ["460 plain characters", "a".repeat(460), 4],
    ["80 extension characters (two units each)", "€".repeat(80), 1],
    ["81 extension characters", "€".repeat(81), 2],
    ["GSM accented letters", "é".repeat(160), 1],
    ["35 emoji (70 UTF-16 units)", "😀".repeat(35), 1],
    ["36 emoji", "😀".repeat(36), 2],
    ["one non-GSM letter in long text", `${"a".repeat(140)}ê`, 3],
  ])("counts %s", (_case, text, segments) => {
    expect(smsSegments(text)).toBe(segments);
  });
});

describe("POST /admin/broadcasts", () => {
  it("saves a draft, with who wrote it", async () => {
    const input = draft();
    const res = await api.post("/admin/broadcasts").set(auth(studio.token)).send(input);

    expectStatus(res, 201);
    trackForCleanup("broadcasts", { id: res.body.data.id });
    expect(res.body.message).toBe("Broadcast created successfully");
    expect(res.body.data).toMatchObject({
      ...input,
      smsText: null,
      smsSegments: smsSegments(`${input.title}: ${input.body}`),
      status: "draft",
      scheduledFor: null,
      sentAt: null,
      createdBy: { id: studio.userId, fullName: studio.fullName },
      updatedBy: { id: studio.userId, fullName: studio.fullName },
      cancelledBy: null,
    });

    await flushActivityLogs();
    const entry = await db("activityLogs")
      .where({ action: "broadcast.create", targetId: res.body.data.id })
      .first();
    expect(entry).toMatchObject({ module: "broadcasts", actorId: studio.userId });
  });

  it.each([
    ["no channel", { channels: [] }],
    ["the same channel twice", { channels: ["push", "push"] }],
    ["an unknown channel", { channels: ["fax"] }],
    ["an unknown audience", { audience: "staff" }],
    ["an empty title", { title: "  " }],
  ])("refuses %s", async (_case, overrides) => {
    const res = await api.post("/admin/broadcasts").set(auth(studio.token)).send(draft(overrides));

    expectStatus(res, 400);
  });

  it("refuses an SMS longer than 3 messages, but not when sms isn't a channel", async () => {
    const long = { body: "a".repeat(460), channels: ["sms"] };

    expectError(
      await api.post("/admin/broadcasts").set(auth(studio.token)).send(draft(long)),
      400,
      "The SMS would be 4 messages long; keep it to 3 or set a shorter smsText",
    );
    expect((await createDraft({ ...long, channels: ["email"] })).smsSegments).toBe(4);
  });

  it("sends the shorter smsText instead of title and body", async () => {
    const broadcast = await createDraft({
      body: "a".repeat(1500),
      smsText: "Nframa: Mon commutes Accra-Tema use Spintex Rd. Pickups up to 10 min later.",
      channels: ["sms", "email"],
    });

    expect(broadcast).toMatchObject({ smsSegments: 1, channels: ["sms", "email"] });
  });

  it("needs broadcasts: create", async () => {
    const reader = await createSignedInAdmin(superAdmin.token, { broadcasts: { read: true } });

    expectError(
      await api.post("/admin/broadcasts").set(auth(reader.token)).send(draft()),
      403,
      "Missing permission: create on broadcasts",
    );
  });
});

describe("GET /admin/broadcasts and /admin/broadcasts/:id", () => {
  it("finds a broadcast by words in its title, newest first, with the filters", async () => {
    const tag = randomUUID().slice(0, 8);
    const older = await createDraft({ title: `Fuel notice ${tag}`, audience: "riders" });
    const newer = await scheduled({ title: `Fuel notice ${tag} update`, channels: ["sms"] });

    const all = await api.get("/admin/broadcasts").query({ search: tag }).set(auth(studio.token));
    expectStatus(all, 200);
    expect(all.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(all.body.data.pagination).toEqual({ page: 1, limit: 20, totalItems: 2, totalPages: 1 });

    for (const [query, expected] of [
      [{ status: "scheduled" }, [newer.id]],
      [{ audience: "riders" }, [older.id]],
      [{ channel: "sms" }, [newer.id]],
      [{ channel: "email" }, []],
    ] as const) {
      const res = await api
        .get("/admin/broadcasts")
        .query({ search: tag, ...query })
        .set(auth(studio.token));
      expectStatus(res, 200);
      expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual(expected);
    }
  });

  it("treats % and _ in the search as plain characters", async () => {
    const res = await api.get("/admin/broadcasts").query({ search: "%_%" }).set(auth(studio.token));

    expectStatus(res, 200);
    expect(res.body.data.items).toEqual([]);
  });

  it("gets one broadcast, or 404", async () => {
    const broadcast = await createDraft();

    const res = await api.get(`/admin/broadcasts/${broadcast.id}`).set(auth(studio.token));
    expectStatus(res, 200);
    expect(res.body.data).toEqual(broadcast);

    const missing = randomUUID();
    expectError(
      await api.get(`/admin/broadcasts/${missing}`).set(auth(studio.token)),
      404,
      `Broadcast not found: ${missing}`,
    );
  });

  it("is staff-only", async () => {
    const rider = await signUpByPhone("rider");

    expectError(
      await api.get("/admin/broadcasts").set(auth(rider.token)),
      403,
      "Missing permission: read on broadcasts",
    );
  });
});

describe("GET /admin/broadcasts/audience-preview", () => {
  it("counts the audience and how many each channel reaches", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api
      .get("/admin/broadcasts/audience-preview")
      .query({ audience: "riders" })
      .set(auth(studio.token));

    expectStatus(res, 200);
    const { audience, recipients, reachable } = res.body.data;
    expect(audience).toBe("riders");
    expect(recipients).toBeGreaterThanOrEqual(1);
    expect(reachable.inApp).toBe(recipients);
    for (const channel of ["push", "sms", "email"]) {
      expect(reachable[channel]).toBeGreaterThanOrEqual(0);
      expect(reachable[channel]).toBeLessThanOrEqual(recipients);
    }
    expect(rider.userId).toBeDefined();
  });

  it("needs an audience", async () => {
    const res = await api.get("/admin/broadcasts/audience-preview").set(auth(studio.token));

    expectStatus(res, 400);
  });
});

describe("GET /admin/broadcasts/sms-balance", () => {
  it("reports the SMS units left", async () => {
    const res = await api.get("/admin/broadcasts/sms-balance").set(auth(studio.token));

    expectStatus(res, 200);
    expect(res.body.data).toEqual({ smsUnits: 4820, mainBalance: "GHS 120.50" });
  });

  it("is for staff with broadcasts: read", async () => {
    const rider = await signUpByPhone("rider");

    expectError(
      await api.get("/admin/broadcasts/sms-balance").set(auth(rider.token)),
      403,
      "Missing permission: read on broadcasts",
    );
  });
});

describe("PATCH /admin/broadcasts/:id", () => {
  it("edits a draft, and smsText null goes back to title and body", async () => {
    const broadcast = await createDraft({ smsText: "Short text", channels: ["sms"] });

    const res = await api
      .patch(`/admin/broadcasts/${broadcast.id}`)
      .set(auth(studio.token))
      .send({ title: "Updated title", smsText: null, audience: "all" });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      title: "Updated title",
      body: broadcast.body,
      smsText: null,
      audience: "all",
      status: "draft",
    });
  });

  it("checks the SMS length against what the broadcast becomes", async () => {
    const broadcast = await createDraft({ body: "a".repeat(600), channels: ["push"] });

    expectError(
      await api
        .patch(`/admin/broadcasts/${broadcast.id}`)
        .set(auth(studio.token))
        .send({ channels: ["push", "sms"] }),
      400,
      "The SMS would be 5 messages long; keep it to 3 or set a shorter smsText",
    );
  });

  it("keeps a scheduled broadcast scheduled", async () => {
    const broadcast = await scheduled();

    const res = await api
      .patch(`/admin/broadcasts/${broadcast.id}`)
      .set(auth(studio.token))
      .send({ body: "New details." });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      body: "New details.",
      status: "scheduled",
      scheduledFor: broadcast.scheduledFor,
    });
  });

  it("needs a field to change", async () => {
    const broadcast = await createDraft();

    const res = await api
      .patch(`/admin/broadcasts/${broadcast.id}`)
      .set(auth(studio.token))
      .send({});

    expectStatus(res, 400);
  });
});

describe("POST /admin/broadcasts/:id/schedule", () => {
  it("schedules a draft, and moves a scheduled one", async () => {
    const broadcast = await createDraft();
    const at = inMinutes(30);

    const first = await api
      .post(`/admin/broadcasts/${broadcast.id}/schedule`)
      .set(auth(studio.token))
      .send({ scheduledFor: at });
    expectStatus(first, 200);
    expect(first.body.data).toMatchObject({ status: "scheduled", scheduledFor: at });

    const later = inMinutes(120);
    const moved = await api
      .post(`/admin/broadcasts/${broadcast.id}/schedule`)
      .set(auth(studio.token))
      .send({ scheduledFor: later });
    expectStatus(moved, 200);
    expect(moved.body.data.scheduledFor).toBe(later);
  });

  it.each([
    ["in the past", -5, "scheduledFor must be at least a minute from now"],
    ["less than a minute away", 0.5, "scheduledFor must be at least a minute from now"],
    ["more than 90 days ahead", 91 * 24 * 60, "scheduledFor can be at most 90 days ahead"],
  ])("refuses a time %s", async (_case, minutes, message) => {
    const broadcast = await createDraft();

    const res = await api
      .post(`/admin/broadcasts/${broadcast.id}/schedule`)
      .set(auth(studio.token))
      .send({ scheduledFor: inMinutes(minutes) });

    expectError(res, 400, message);
  });

  it("refuses a time without a timezone", async () => {
    const broadcast = await createDraft();

    const res = await api
      .post(`/admin/broadcasts/${broadcast.id}/schedule`)
      .set(auth(studio.token))
      .send({ scheduledFor: "2026-12-01T08:00:00" });

    expectStatus(res, 400);
  });
});

describe("POST /admin/broadcasts/:id/cancel", () => {
  it("cancels a scheduled broadcast, which then can't be changed", async () => {
    const broadcast = await scheduled();

    const res = await api.post(`/admin/broadcasts/${broadcast.id}/cancel`).set(auth(studio.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      status: "cancelled",
      cancelledBy: { id: studio.userId, fullName: studio.fullName },
    });
    expect(res.body.data.cancelledAt).toEqual(expect.any(String));

    const refused = [
      [
        api.post(`/admin/broadcasts/${broadcast.id}/cancel`),
        "The broadcast is cancelled, so it can't be cancelled",
      ],
      [
        api.patch(`/admin/broadcasts/${broadcast.id}`).send({ title: "Again" }),
        "The broadcast is cancelled, so it can't be edited",
      ],
      [
        api
          .post(`/admin/broadcasts/${broadcast.id}/schedule`)
          .send({ scheduledFor: inMinutes(60) }),
        "The broadcast is cancelled, so it can't be scheduled",
      ],
      [
        api.delete(`/admin/broadcasts/${broadcast.id}`),
        "The broadcast is cancelled, so it can't be deleted; only drafts can",
      ],
    ] as const;
    for (const [request, message] of refused) {
      expectError(await request.set(auth(studio.token)), 409, message);
    }
  });

  it("points a draft to deleting instead", async () => {
    const broadcast = await createDraft();

    expectError(
      await api.post(`/admin/broadcasts/${broadcast.id}/cancel`).set(auth(studio.token)),
      409,
      "Only a scheduled broadcast can be cancelled; delete a draft instead",
    );
  });
});

describe("DELETE /admin/broadcasts/:id", () => {
  it("deletes a draft", async () => {
    const broadcast = await createDraft();

    const res = await api.delete(`/admin/broadcasts/${broadcast.id}`).set(auth(studio.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Broadcast deleted successfully");
    expectStatus(await api.get(`/admin/broadcasts/${broadcast.id}`).set(auth(studio.token)), 404);
  });

  it("keeps a scheduled one", async () => {
    const broadcast = await scheduled();

    expectError(
      await api.delete(`/admin/broadcasts/${broadcast.id}`).set(auth(studio.token)),
      409,
      "The broadcast is scheduled, so it can't be deleted; only drafts can",
    );
  });

  it("needs broadcasts: delete", async () => {
    const editor = await createSignedInAdmin(superAdmin.token, {
      broadcasts: { read: true, create: true, update: true },
    });
    const broadcast = await createDraft();

    expectError(
      await api.delete(`/admin/broadcasts/${broadcast.id}`).set(auth(editor.token)),
      403,
      "Missing permission: delete on broadcasts",
    );
  });
});
