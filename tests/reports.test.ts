import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { URGENT_REPORT_CATEGORIES } from "../src/schemas/report.schema.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { sendViaResend } from "../src/services/resend.service.js";
import { emitToReportsDesk, emitToUser } from "../src/services/socket.service.js";
import { deleteFile, uploadFile } from "../src/services/storage.service.js";
import { addDays, today } from "../src/utils/tripTime.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { REQUEST_ID_PREFIX, trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";
import { bookableCommute, bookingRider, insertTrip } from "./helpers/trips.js";
import { newEmail } from "./helpers/unique.js";

type Person = { userId: string; token: string };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let staff: Awaited<ReturnType<typeof createSignedInAdmin>>; // reports: read, update
let reader: Awaited<ReturnType<typeof createSignedInAdmin>>; // reports: read only
let usersAdmin: Awaited<ReturnType<typeof createSignedInAdmin>>; // users and sos, but no reports
let outsider: Awaited<ReturnType<typeof createSignedInAdmin>>; // no relevant access
let rider: Awaited<ReturnType<typeof bookingRider>>;
let driver: Awaited<ReturnType<typeof bookableCommute>>["driver"];
let commute: Awaited<ReturnType<typeof bookableCommute>>["commute"];
let stranger: Person; // a rider who was on none of the trips
let flooder: Person; // only ever used to hit the rate limit
let driverEmail: string;

const text = "The driver kept asking for my number after I said no, and would not stop.";

let dayCounter = 0;
const futureDate = () => addDays(today(), 10 + ++dayCounter);
const pastDate = () => addDays(today(), -(10 + ++dayCounter));
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

// A trip between the shared rider and driver in the given state. Trips that can still be reported are in the
// future, so the lazy sweep never settles them; ended ones are in the past.
function tripWith(status: string, overrides: Record<string, unknown> = {}) {
  const live = status === "accepted" || status === "boarded";
  const accepted = status !== "pending" && status !== "declined" && status !== "expired";
  return insertTrip(commute, rider.userId, {
    status,
    tripDate: live ? futureDate() : pastDate(),
    ...(accepted ? { acceptedAt: hoursAgo(80) } : {}),
    ...overrides,
  });
}

function file(caller: { token: string }, tripId: string, body: object = { category: "harassment", description: text }) {
  return api.post(`/trips/${tripId}/reports`).set(auth(caller.token)).send(body);
}

async function report(caller: Person, tripId: string, body?: object) {
  const res = await file(caller, tripId, body);
  expectStatus(res, 201);
  trackForCleanup("tripReports", { id: res.body.data.id });
  return res.body.data as { id: string; status: string; severity: string; evidence: { fileUrl: string }[] };
}

// Reports staff act on don't need anyone to file them through the API (which is rate limited per account).
async function seedReport(
  over: Partial<{
    category: string;
    severity: string;
    status: string;
    reporter: Person;
    reported: Person;
    tripId: string;
    internalNotes: string;
  }> = {},
) {
  const reporter = over.reporter ?? rider;
  const reported = over.reported ?? driver;
  const tripId = over.tripId ?? (await tripWith("completed", { completedAt: hoursAgo(2) })).id;
  const [row] = await db("tripReports")
    .insert({
      tripId,
      reporterUserId: reporter.userId,
      reportedUserId: reported.userId,
      reporterRole: reporter === driver ? "driver" : "rider",
      category: over.category ?? "harassment",
      severity: over.severity ?? "normal",
      description: text,
      tripStatus: "completed",
      status: over.status ?? "open",
      internalNotes: over.internalNotes ?? null,
    })
    .returning("*");
  trackForCleanup("tripReports", { id: row.id });
  return row as { id: string; tripId: string };
}

const staffMove = (admin: { token: string }, id: string, body: object) =>
  api.patch(`/admin/reports/${id}`).set(auth(admin.token)).send(body);

const sentTo = (email: string) =>
  vi
    .mocked(sendViaResend)
    .mock.calls.map(([message]) => message)
    .filter((message) => message.to === email);

const waitForMail = (email: string, subject: string, contains = "") =>
  vi.waitFor(
    () => {
      const mail = sentTo(email).find((m) => m.subject === subject && m.html.includes(contains));
      if (!mail) throw new Error(`No "${subject}" mail to ${email}`);
      return mail;
    },
    { timeout: 10_000, interval: 50 },
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

const deskEvents = (event: string, reportId: string) =>
  vi
    .mocked(emitToReportsDesk)
    .mock.calls.filter(
      ([name, payload]) => name === event && (payload as { reportId: string }).reportId === reportId,
    );

const userEvents = (userId: string, event: string, reportId: string) =>
  vi
    .mocked(emitToUser)
    .mock.calls.filter(
      ([to, name, payload]) =>
        to === userId && name === event && (payload as { reportId: string }).reportId === reportId,
    );

async function giveEmail(userId: string) {
  const email = await newEmail(data.person());
  expectStatus(
    await api.patch(`/users/${userId}`).set(auth(superAdmin.token)).send({ email }),
    200,
  );
  return email;
}

const png = () => Buffer.from("89504e470d0a1a0a", "hex");

beforeAll(async () => {
  // A failing upload on demand: the default mock keeps working for every other file name.
  vi.mocked(uploadFile).mockImplementation(async (_buffer, folder, originalFilename) => {
    if (originalFilename.startsWith("fail-")) throw new Error("The storage provider is down");
    const storageKey = `${folder}/${randomUUID()}-${originalFilename}`;
    return { fileUrl: `https://mock-storage.test/${storageKey}`, storageKey };
  });

  superAdmin = await loginAsSuperAdmin();
  const [admins, shared, riderOnTrips, outsiderRider, floodRider] = await Promise.all([
    Promise.all([
      createSignedInAdmin(superAdmin.token, { reports: { read: true, update: true } }),
      createSignedInAdmin(superAdmin.token, { reports: { read: true } }),
      createSignedInAdmin(superAdmin.token, {
        users: { create: true, read: true, update: true, delete: true },
        sos: { create: true, read: true, update: true, delete: true },
      }),
      createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
    ]),
    bookableCommute(),
    bookingRider(0),
    signUpByPhone("rider"),
    signUpByPhone("rider"),
  ]);
  [staff, reader, usersAdmin, outsider] = admins;
  driver = shared.driver;
  commute = shared.commute;
  rider = riderOnTrips;
  stranger = outsiderRider;
  flooder = floodRider;
  driverEmail = await giveEmail(driver.userId);
});

describe("POST /trips/:tripId/reports", () => {
  it("lets a rider report their driver, who is worked out from the trip and never told", async () => {
    const trip = await tripWith("accepted");

    const res = await file(rider, trip.id);

    expectStatus(res, 201);
    trackForCleanup("tripReports", { id: res.body.data.id });
    expect(res.body.message).toBe("Report filed successfully");
    expect(res.body.data).toMatchObject({
      tripId: trip.id,
      reporterRole: "rider",
      category: "harassment",
      severity: "normal",
      description: text,
      tripStatus: "accepted",
      evidence: [],
      status: "open",
      outcomeMessage: null,
      resolvedAt: null,
    });
    for (const staffOnly of ["internalNotes", "handledByAdminId", "reportedUserId", "reporterUserId"]) {
      expect(res.body.data).not.toHaveProperty(staffOnly);
    }
    const row = await db("tripReports").where({ id: res.body.data.id }).first();
    expect(row).toMatchObject({ reporterUserId: rider.userId, reportedUserId: driver.userId });
    expect(deskEvents("report:created", res.body.data.id)).toHaveLength(1);
    expect(userEvents(driver.userId, "report:statusChanged", res.body.data.id)).toHaveLength(0);
  });

  it("lets a driver report their rider", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(1) });

    const created = await report(driver, trip.id, { category: "propertyDamage", description: text });

    const row = await db("tripReports").where({ id: created.id }).first();
    expect(row).toMatchObject({
      reporterRole: "driver",
      reporterUserId: driver.userId,
      reportedUserId: rider.userId,
      tripStatus: "completed",
    });
  });

  it("works while the trip is under way, and notes that it was", async () => {
    const trip = await tripWith("boarded");

    const created = await report(rider, trip.id, { category: "unsafeDriving", description: text });

    const row = await db("tripReports").where({ id: created.id }).first();
    expect(row.tripStatus).toBe("boarded");
  });

  it("derives the severity from the category: safety ones are urgent", async () => {
    const [urgentTrip, normalTrip] = [await tripWith("accepted"), await tripWith("accepted")];

    const urgent = await report(rider, urgentTrip.id, { category: "physicalAssault", description: text });
    const normal = await report(rider, normalTrip.id, { category: "lateOrNoShow", description: text });

    expect(urgent.severity).toBe("urgent");
    expect(normal.severity).toBe("normal");
    expect([...URGENT_REPORT_CATEGORIES].sort()).toEqual(
      [
        "physicalAssault",
        "sexualMisconduct",
        "suspectedIntoxication",
        "threatOrIntimidation",
        "unsafeDriving",
      ].sort(),
    );
  });

  it("ignores a severity the client tries to set", async () => {
    const trip = await tripWith("accepted");

    const created = await report(rider, trip.id, {
      category: "lateOrNoShow",
      description: text,
      severity: "urgent",
    });

    expect(created.severity).toBe("normal");
  });

  it("allows a trip that ended recently, whichever way it ended after being accepted", async () => {
    const trips = await Promise.all([
      tripWith("completed", { completedAt: hoursAgo(71) }),
      tripWith("no_show", { cancelledAt: hoursAgo(5) }),
      tripWith("cancelled", { cancelledAt: hoursAgo(5), cancelledBy: "rider" }),
    ]);

    for (const trip of trips) {
      await report(driver, trip.id, { category: "lateOrNoShow", description: text });
    }
  });

  it("refuses once the filing window after the trip has passed", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(73) });

    const res = await file(rider, trip.id);

    expectStatus(res, 409);
    expect(res.body.error).toBe("Reports can be filed up to 72 hours after a trip ends");
  });

  it.each(["pending", "declined", "expired"])("refuses a trip that is %s: nobody accepted it", async (status) => {
    const trip = await tripWith(status);

    const res = await file(driver, trip.id);

    expectStatus(res, 409);
    expect(res.body.error).toBe(`Can't report a trip that is ${status}`);
  });

  it("refuses a trip that was cancelled before it was accepted", async () => {
    const trip = await tripWith("cancelled", { acceptedAt: null, cancelledAt: hoursAgo(1) });

    const res = await file(rider, trip.id);

    expectStatus(res, 409);
    expect(res.body.error).toBe("Can't report a trip that was cancelled before it was accepted");
  });

  it("is for the trip's own rider and driver: not a stranger, not an admin", async () => {
    const trip = await tripWith("accepted");

    for (const caller of [stranger, superAdmin]) {
      const res = await file(caller, trip.id);

      expectStatus(res, 403);
      expect(res.body.error).toBe("Only the trip's rider or driver can report it");
    }
    expect(await db("tripReports").where({ tripId: trip.id })).toHaveLength(0);
  });

  it("404s for an unknown trip, 400s for a bad id, and needs a signed-in user", async () => {
    const id = randomUUID();

    const missing = await file(rider, id);
    const badId = await file(rider, "not-a-uuid");
    const anonymous = await api.post(`/trips/${id}/reports`).send({ category: "other", description: text });

    expectStatus(missing, 404);
    expect(missing.body.error).toBe(`Trip not found: ${id}`);
    expectStatus(badId, 400);
    expectStatus(anonymous, 401);
  });

  it.each([
    ["an unknown category", { category: "rudeness", description: text }],
    ["no category", { description: text }],
    ["a description that is too short", { category: "other", description: "bad" }],
    ["a description that is too long", { category: "other", description: "x".repeat(2001) }],
    ["no description", { category: "other" }],
  ])("rejects %s", async (_name, body) => {
    const res = await file(stranger, randomUUID(), body);

    expectStatus(res, 400);
  });

  it("answers 409 for a second open report in the same category, but not for a different one", async () => {
    const trip = await tripWith("accepted");
    await report(rider, trip.id, { category: "harassment", description: text });

    const again = await file(rider, trip.id, { category: "harassment", description: text });
    const other = await report(rider, trip.id, { category: "discrimination", description: text });

    expectStatus(again, 409);
    expect(again.body.error).toBe("You already have an open report about this trip in that category");
    expect(other.status).toBe("open");
  });

  it("lets the same issue be filed again once the last report is closed", async () => {
    const trip = await tripWith("accepted");
    const first = await report(rider, trip.id, { category: "harassment", description: text });
    expectStatus(await api.patch(`/reports/${first.id}/withdraw`).set(auth(rider.token)), 200);

    const second = await report(rider, trip.id, { category: "harassment", description: text });

    expect(second.id).not.toBe(first.id);
  });

  it("files one report when the same one is sent twice at once", async () => {
    const trip = await tripWith("accepted");

    const results = await Promise.all([file(rider, trip.id), file(rider, trip.id)]);

    for (const res of results) {
      if (res.status === 201) trackForCleanup("tripReports", { id: res.body.data.id });
    }
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  });

  it("is rate limited per account", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await file(flooder, randomUUID(), {})).status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("keeps the description out of the audit trail", async () => {
    const trip = await tripWith("accepted");
    const created = await report(rider, trip.id, { category: "other", description: text });

    await flushActivityLogs();
    const [entry] = await db("activityLogs")
      .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
      .where({ action: "report.create", targetId: created.id });

    expect(entry).toMatchObject({ module: "reports", actorId: rider.userId });
    expect(entry.requestBody.description).toBe("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("asking for my number");
    expect(entry.after).toMatchObject({ category: "other", status: "open", evidenceCount: 0 });
  });
});

describe("report evidence", () => {
  const multipart = (tripId: string, caller: { token: string } = driver) =>
    api
      .post(`/trips/${tripId}/reports`)
      .set(auth(caller.token))
      .field("category", "harassment")
      .field("description", text);

  it("attaches images sent with the report, returning their URLs but never their storage keys", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(1) });

    const res = await multipart(trip.id)
      .attach("evidence", png(), { filename: "first.png", contentType: "image/png" })
      .attach("evidence", png(), { filename: "second.jpg", contentType: "image/jpeg" });

    expectStatus(res, 201);
    trackForCleanup("tripReports", { id: res.body.data.id });
    expect(res.body.data.evidence).toHaveLength(2);
    expect(res.body.data.evidence[0].fileUrl).toMatch(/^https:\/\/mock-storage\.test\/reports\/.+first\.png$/);
    expect(JSON.stringify(res.body)).not.toContain("storageKey");
    const row = await db("tripReports").where({ id: res.body.data.id }).first();
    expect(row.evidence).toHaveLength(2);
    expect(row.evidence[0].storageKey).toContain(res.body.data.id);
  });

  it("takes up to five images, and refuses a sixth", async () => {
    const [fiveTrip, sixTrip] = [
      await tripWith("completed", { completedAt: hoursAgo(1) }),
      await tripWith("completed", { completedAt: hoursAgo(1) }),
    ];
    const attachAll = (req: ReturnType<typeof multipart>, count: number) => {
      for (let i = 0; i < count; i += 1) {
        req.attach("evidence", png(), { filename: `photo-${i}.png`, contentType: "image/png" });
      }
      return req;
    };

    const five = await attachAll(multipart(fiveTrip.id), 5);
    const six = await attachAll(multipart(sixTrip.id), 6);

    expectStatus(five, 201);
    trackForCleanup("tripReports", { id: five.body.data.id });
    expect(five.body.data.evidence).toHaveLength(5);
    expectStatus(six, 400);
    expect(six.body.error).toBe("You can attach up to 5 images, under the 'evidence' field");
    expect(await db("tripReports").where({ tripId: sixTrip.id })).toHaveLength(0);
  });

  it("refuses anything that isn't a JPEG, PNG or WEBP image", async () => {
    const trip = await tripWith("accepted");

    const pdf = await multipart(trip.id, stranger)
      .attach("evidence", Buffer.from("%PDF-1.4"), { filename: "scan.pdf", contentType: "application/pdf" });

    expectStatus(pdf, 400);
    expect(pdf.body.error).toBe("Unsupported file type: application/pdf. Allowed: JPEG, PNG, WEBP");
  });

  it("refuses an image over 5MB", async () => {
    const res = await multipart(randomUUID(), stranger).attach("evidence", Buffer.alloc(5 * 1024 * 1024 + 1), {
      filename: "huge.png",
      contentType: "image/png",
    });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Image too large. Maximum size is 5MB each");
  });

  it("files a written report sent as multipart with no images", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(1) });

    const res = await multipart(trip.id);

    expectStatus(res, 201);
    trackForCleanup("tripReports", { id: res.body.data.id });
    expect(res.body.data.evidence).toEqual([]);
  });

  it("takes the uploaded images down again, and files nothing, when an upload fails", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(1) });

    const res = await multipart(trip.id)
      .attach("evidence", png(), { filename: "keep-cleanup.png", contentType: "image/png" })
      .attach("evidence", png(), { filename: "fail-second.png", contentType: "image/png" });

    expect(res.status).toBe(500);
    expect(await db("tripReports").where({ tripId: trip.id })).toHaveLength(0);
    expect(
      vi.mocked(deleteFile).mock.calls.some(([storageKey]) => storageKey.endsWith("-keep-cleanup.png")),
    ).toBe(true);
  });
});

describe("GET /reports and GET /reports/:id", () => {
  it("lists only the reports I filed, newest first, never ones filed about me", async () => {
    const mine = await seedReport();
    const aboutMe = await seedReport({ reporter: driver, reported: rider });

    const res = await api.get("/reports?limit=100").set(auth(rider.token));

    expectStatus(res, 200);
    const ids = res.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(aboutMe.id);
    const times = res.body.data.items.map((item: { createdAt: string }) => Date.parse(item.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100 });
  });

  it("filters by status and by trip, and pages", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(1) });
    const open = await seedReport({ tripId: trip.id, category: "harassment" });
    const closed = await seedReport({ tripId: trip.id, category: "other", status: "dismissed" });

    const byTrip = await api.get(`/reports?tripId=${trip.id}`).set(auth(rider.token));
    const byStatus = await api.get(`/reports?tripId=${trip.id}&status=dismissed`).set(auth(rider.token));
    const paged = await api.get(`/reports?tripId=${trip.id}&limit=1&page=2`).set(auth(rider.token));

    expect(byTrip.body.data.items.map((item: { id: string }) => item.id).sort()).toEqual([open.id, closed.id].sort());
    expect(byStatus.body.data.items.map((item: { id: string }) => item.id)).toEqual([closed.id]);
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.pagination).toMatchObject({ totalItems: 2, totalPages: 2 });
  });

  it("shows one report, without staff's notes, and closes the staff's message in", async () => {
    const seeded = await seedReport({ internalNotes: "Prior complaint on file" });
    await staffMove(staff, seeded.id, {
      status: "resolved",
      outcomeMessage: "We spoke to the driver.",
    });

    const res = await api.get(`/reports/${seeded.id}`).set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ id: seeded.id, status: "resolved", outcomeMessage: "We spoke to the driver." });
    expect(JSON.stringify(res.body)).not.toContain("Prior complaint");
    for (const staffOnly of ["internalNotes", "handledByAdminId", "reportedUserId"]) {
      expect(res.body.data).not.toHaveProperty(staffOnly);
    }
  });

  it("answers 404 for the person reported and for strangers: they can't tell it exists", async () => {
    const seeded = await seedReport();

    for (const caller of [driver, stranger]) {
      const res = await api.get(`/reports/${seeded.id}`).set(auth(caller.token));

      expectStatus(res, 404);
      expect(res.body.error).toBe(`Report not found: ${seeded.id}`);
    }
  });

  it("400s for a bad id and bad filters, and needs a signed-in user", async () => {
    expectStatus(await api.get("/reports/not-a-uuid").set(auth(rider.token)), 400);
    expectStatus(await api.get("/reports?status=maybe").set(auth(rider.token)), 400);
    expectStatus(await api.get("/reports"), 401);
    expectStatus(await api.get(`/reports/${randomUUID()}`).set(auth(rider.token)), 404);
  });
});

describe("PATCH /reports/:id/withdraw", () => {
  it.each(["open", "underReview"])("takes back a report that is %s, and tells the desk", async (from) => {
    const seeded = await seedReport({ status: from });

    const res = await api.patch(`/reports/${seeded.id}/withdraw`).set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data.status).toBe("withdrawn");
    expect(deskEvents("report:statusChanged", seeded.id)).toMatchObject([
      ["report:statusChanged", { reportId: seeded.id, status: "withdrawn" }],
    ]);
  });

  it.each(["resolved", "dismissed", "withdrawn"])("is refused for a report that is already %s", async (status) => {
    const seeded = await seedReport({ status });

    const res = await api.patch(`/reports/${seeded.id}/withdraw`).set(auth(rider.token));

    expectStatus(res, 409);
    expect(res.body.error).toBe(`Can't withdraw a report that is ${status}`);
  });

  it("is only for the person who filed it", async () => {
    const seeded = await seedReport();

    for (const caller of [driver, stranger]) {
      expectStatus(await api.patch(`/reports/${seeded.id}/withdraw`).set(auth(caller.token)), 404);
    }
    expectStatus(await api.patch(`/reports/${seeded.id}/withdraw`), 401);
  });

  it("lets exactly one win when the reporter withdraws as staff close it", async () => {
    const seeded = await seedReport();

    const [withdrawn, closed] = await Promise.all([
      api.patch(`/reports/${seeded.id}/withdraw`).set(auth(rider.token)),
      staffMove(staff, seeded.id, { status: "resolved" }),
    ]);

    expect([withdrawn.status, closed.status].sort()).toEqual([200, 409]);
    const final = (await db("tripReports").where({ id: seeded.id }).first()).status;
    expect(final).toBe(withdrawn.status === 200 ? "withdrawn" : "resolved");
  });
});

describe("GET /admin/reports", () => {
  it("puts unresolved before closed, and urgent before normal, with both people's names", async () => {
    const marker = await seedReport({ category: "other" });
    const trio = {
      closedNormal: await seedReport({ status: "resolved" }),
      openNormal: await seedReport({ category: "lateOrNoShow" }),
      openUrgent: await seedReport({ category: "physicalAssault", severity: "urgent" }),
    };

    const res = await api
      .get(`/admin/reports?reportedUserId=${driver.userId}&limit=100`)
      .set(auth(reader.token));

    expectStatus(res, 200);
    const ids: string[] = res.body.data.items.map((item: { id: string }) => item.id);
    expect(ids.indexOf(trio.openUrgent.id)).toBeLessThan(ids.indexOf(trio.openNormal.id));
    expect(ids.indexOf(trio.openNormal.id)).toBeLessThan(ids.indexOf(trio.closedNormal.id));
    expect(ids).toContain(marker.id);
    const item = res.body.data.items.find((i: { id: string }) => i.id === trio.openUrgent.id);
    expect(item).toMatchObject({ reporterUserId: rider.userId, reportedUserId: driver.userId });
    expect(item.reporterName).toEqual(expect.any(String));
    expect(item.reportedName).toEqual(expect.any(String));
  });

  it("filters by status, severity, category, trip, people and filing date", async () => {
    const urgent = await seedReport({ category: "sexualMisconduct", severity: "urgent", reporter: driver, reported: rider });
    await seedReport({ category: "other" });
    const ids = async (query: string) =>
      (await api.get(`/admin/reports?${query}&limit=100`).set(auth(reader.token))).body.data.items.map(
        (item: { id: string }) => item.id,
      );

    expect(await ids(`severity=urgent&reporterUserId=${driver.userId}`)).toContain(urgent.id);
    expect(await ids(`category=sexualMisconduct&reportedUserId=${rider.userId}`)).toContain(urgent.id);
    expect(await ids(`tripId=${urgent.tripId}`)).toEqual([urgent.id]);
    expect(await ids(`tripId=${urgent.tripId}&status=dismissed`)).toEqual([]);
    expect(await ids(`tripId=${urgent.tripId}&from=${today()}&to=${today()}`)).toEqual([urgent.id]);
    expect(await ids(`tripId=${urgent.tripId}&to=${addDays(today(), -1)}`)).toEqual([]);
  });

  it("pages", async () => {
    const trip = await tripWith("completed", { completedAt: hoursAgo(1) });
    await seedReport({ tripId: trip.id, category: "harassment" });
    await seedReport({ tripId: trip.id, category: "other" });

    const res = await api.get(`/admin/reports?tripId=${trip.id}&limit=1`).set(auth(reader.token));

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 1, totalItems: 2, totalPages: 2 });
  });

  it("needs reports: read: not users, not sos, not a rider", async () => {
    for (const caller of [usersAdmin, outsider]) {
      const res = await api.get("/admin/reports").set(auth(caller.token));

      expectStatus(res, 403);
      expect(res.body.error).toBe("Missing permission: read on reports");
    }
    expectStatus(await api.get("/admin/reports").set(auth(rider.token)), 403);
    expectStatus(await api.get("/admin/reports"), 401);
  });

  it("rejects bad filters, such as a status or a date that doesn't exist", async () => {
    expectStatus(await api.get("/admin/reports?status=maybe").set(auth(reader.token)), 400);
    expectStatus(await api.get("/admin/reports?from=yesterday").set(auth(reader.token)), 400);
    expectStatus(await api.get("/admin/reports?severity=high").set(auth(reader.token)), 400);
  });
});

describe("GET /admin/reports/:id", () => {
  it("shows the full picture: both people, the trip, notes, and how often each appears", async () => {
    const seeded = await seedReport({ internalNotes: "Call the driver" });
    await seedReport();
    await seedReport({ status: "resolved" });

    const res = await api.get(`/admin/reports/${seeded.id}`).set(auth(reader.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      id: seeded.id,
      internalNotes: "Call the driver",
      reporterUserId: rider.userId,
      reportedUserId: driver.userId,
      reporter: { id: rider.userId, role: "rider" },
      reported: { id: driver.userId, role: "driver" },
      trip: { id: seeded.tripId, status: "completed" },
    });
    expect(res.body.data.reporter.phone).toMatch(/^\+/);
    expect(res.body.data.reported.phone).toMatch(/^\+/);
    expect(res.body.data.history.reportedAgainst).toBeGreaterThanOrEqual(3);
    expect(res.body.data.history.reportedUnresolved).toBeGreaterThanOrEqual(2);
    expect(res.body.data.history.reporterFiled).toBeGreaterThanOrEqual(3);
  });

  it("records the view in the audit trail", async () => {
    const seeded = await seedReport();
    await api.get(`/admin/reports/${seeded.id}`).set(auth(reader.token));

    await flushActivityLogs();
    const entries = await db("activityLogs").where({ action: "report.view", targetId: seeded.id });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ module: "reports", actorId: reader.userId });
  });

  it("404s for an unknown report, 400s for a bad id, and needs reports: read", async () => {
    const id = randomUUID();
    const seeded = await seedReport();

    const missing = await api.get(`/admin/reports/${id}`).set(auth(reader.token));

    expectStatus(missing, 404);
    expect(missing.body.error).toBe(`Report not found: ${id}`);
    expectStatus(await api.get("/admin/reports/not-a-uuid").set(auth(reader.token)), 400);
    expectStatus(await api.get(`/admin/reports/${seeded.id}`).set(auth(usersAdmin.token)), 403);
    expectStatus(await api.get(`/admin/reports/${seeded.id}`).set(auth(driver.token)), 403);
  });
});

describe("PATCH /admin/reports/:id", () => {
  // The driver files these reports about a rider of their own, so nothing else in this file mails that rider.
  async function reportAboutOwnRider() {
    const reported = await signUpByPhone("rider");
    const reportedEmail = await giveEmail(reported.userId);
    const trip = await insertTrip(commute, reported.userId, {
      status: "completed",
      tripDate: pastDate(),
      acceptedAt: hoursAgo(80),
      completedAt: hoursAgo(1),
    });
    return { trip, reported, reportedEmail };
  }

  it("picks a report up and closes it, recording who and when, and telling the reporter alone", async () => {
    const { trip, reported, reportedEmail } = await reportAboutOwnRider();
    const created = await report(driver, trip.id, { category: "harassment", description: text });

    const review = await staffMove(staff, created.id, { status: "underReview", internalNotes: "Calling the driver" });
    expectStatus(review, 200);
    expect(review.body.data).toMatchObject({
      status: "underReview",
      internalNotes: "Calling the driver",
      handledByAdminId: staff.userId,
      resolvedAt: null,
    });
    const resolved = await staffMove(staff, created.id, {
      status: "resolved",
      outcomeMessage: "We have <b>acted</b> on this & will follow up.",
    });

    expectStatus(resolved, 200);
    expect(resolved.body.data.resolvedAt).not.toBeNull();
    expect(resolved.body.data.internalNotes).toBe("Calling the driver");
    expect(userEvents(driver.userId, "report:statusChanged", created.id).map(([, , p]) => (p as { status: string }).status))
      .toEqual(["underReview", "resolved"]);
    expect(deskEvents("report:statusChanged", created.id)).toHaveLength(2);
    expect(userEvents(reported.userId, "report:statusChanged", created.id)).toHaveLength(0);
    await waitForMail(driverEmail, "Your report is being reviewed");
    const mail = await waitForMail(driverEmail, "Your report was resolved", "&lt;b&gt;acted&lt;/b&gt; on this &amp; will follow up.");
    expect(mail.html).not.toContain("Calling the driver");
    await settle();
    expect(sentTo(reportedEmail)).toHaveLength(0);
  });

  it("can dismiss straight from open, and tells the reporter it was closed", async () => {
    const { trip } = await reportAboutOwnRider();
    const created = await report(driver, trip.id, { category: "other", description: text });

    const res = await staffMove(staff, created.id, { status: "dismissed", outcomeMessage: "Not enough to act on." });

    expectStatus(res, 200);
    expect(res.body.data.status).toBe("dismissed");
    const mail = await waitForMail(driverEmail, "Your report was closed", "Not enough to act on.");
    expect(mail.html).toContain("without further action");
  });

  it("emails an urgent reporter a confirmation that points to 112 and SOS", async () => {
    const { trip } = await reportAboutOwnRider();
    await report(driver, trip.id, { category: "threatOrIntimidation", description: text });

    const mail = await waitForMail(driverEmail, "We received your report", "call 112");

    expect(mail.html).toContain("SOS");
  });

  it("keeps notes and the message unless new ones are given", async () => {
    const seeded = await seedReport();
    await staffMove(staff, seeded.id, { status: "underReview", internalNotes: "First note", outcomeMessage: "Hello" });

    const res = await staffMove(staff, seeded.id, { status: "dismissed" });

    expect(res.body.data).toMatchObject({ internalNotes: "First note", outcomeMessage: "Hello" });
  });

  it.each(["resolved", "dismissed", "withdrawn"])("can't change a report that is already %s", async (status) => {
    const seeded = await seedReport({ status });

    const res = await staffMove(staff, seeded.id, { status: "underReview" });

    expectStatus(res, 409);
    expect(res.body.error).toBe(`Can't move a report from ${status} to underReview`);
  });

  it("lets exactly one win when two staff act together", async () => {
    const seeded = await seedReport();

    const results = await Promise.all([
      staffMove(staff, seeded.id, { status: "resolved" }),
      staffMove(staff, seeded.id, { status: "dismissed" }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  it.each([
    ["open, which is only where a report starts", { status: "open" }],
    ["withdrawn, which only the reporter can set", { status: "withdrawn" }],
    ["no status", {}],
    ["notes that are too long", { status: "underReview", internalNotes: "x".repeat(2001) }],
    ["a message that is too long", { status: "resolved", outcomeMessage: "x".repeat(1001) }],
  ])("rejects %s", async (_name, body) => {
    const seeded = await seedReport();

    expectStatus(await staffMove(staff, seeded.id, body), 400);
  });

  it("needs reports: update, and is not for riders or the people involved", async () => {
    const seeded = await seedReport();

    for (const caller of [reader, usersAdmin, outsider, rider, driver]) {
      expectStatus(await staffMove(caller, seeded.id, { status: "resolved" }), 403);
    }
    expectStatus(await api.patch(`/admin/reports/${seeded.id}`).send({ status: "resolved" }), 401);
    expect((await db("tripReports").where({ id: seeded.id }).first()).status).toBe("open");
  });

  it("404s for an unknown report", async () => {
    const id = randomUUID();

    const res = await staffMove(staff, id, { status: "resolved" });

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Report not found: ${id}`);
  });

  it("is recorded in the audit trail without the notes or the message", async () => {
    const seeded = await seedReport();
    await staffMove(staff, seeded.id, {
      status: "resolved",
      internalNotes: "Secret staff note",
      outcomeMessage: "Private outcome text",
    });

    await flushActivityLogs();
    const [entry] = await db("activityLogs").where({ action: "report.updateStatus", targetId: seeded.id });

    expect(entry).toMatchObject({ module: "reports", actorId: staff.userId });
    expect(entry.before.status).toBe("open");
    expect(entry.after.status).toBe("resolved");
    expect(JSON.stringify(entry)).not.toContain("Secret staff note");
    expect(JSON.stringify(entry)).not.toContain("Private outcome text");
  });
});

describe("the reports desk room", () => {
  const joined = async (userId: string, userType: "user" | "admin") => {
    const actual = await vi.importActual<typeof import("../src/services/socket.service.js")>(
      "../src/services/socket.service.js",
    );
    const rooms: string[] = [];
    await actual.joinSocketRooms({
      data: { userId, userType, role: userType === "admin" ? "admin" : "rider" },
      join: (room) => rooms.push(room),
    });
    return rooms;
  };

  it("admits admins who can read reports, and only them", async () => {
    expect(await joined(reader.userId, "admin")).toEqual([`user:${reader.userId}`, "admin:reports"]);
    expect(await joined(staff.userId, "admin")).toContain("admin:reports");
    expect(await joined(usersAdmin.userId, "admin")).toEqual([`user:${usersAdmin.userId}`, "admin:safety"]);
    expect(await joined(outsider.userId, "admin")).toEqual([`user:${outsider.userId}`]);
    expect(await joined(rider.userId, "user")).toEqual([`user:${rider.userId}`]);
  });
});
