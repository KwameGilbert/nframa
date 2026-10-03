import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { emitToSafetyDesk, emitToUser } from "../src/services/socket.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createPhoneAccount,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { bookableCommute, bookingRider, insertTrip } from "./helpers/trips.js";

type Person = { userId: string; token: string };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let dispatcher: Awaited<ReturnType<typeof createSignedInAdmin>>; // sos: read, update
let reader: Awaited<ReturnType<typeof createSignedInAdmin>>; // sos: read only
let outsiderAdmin: Awaited<ReturnType<typeof createSignedInAdmin>>; // no sos access
let usersAdmin: Awaited<ReturnType<typeof createSignedInAdmin>>; // full users access, but no sos access
let trip: Awaited<ReturnType<typeof insertTrip>>;
let tripRider: Person;
let tripDriver: Person;

const point = () => ({
  latitude: 5.60372,
  longitude: -0.17837,
  address: "Accra Mall, Tetteh Quarshie, Accra",
  reason: "Personal/Medical Emergency",
});

// An alert is one per person, so a test that needs its own gets its own person.
const newRider = () => signUpByPhone("rider");

function sos(caller: { token: string }, body: object = point()) {
  return api.post("/safety/sos").set(auth(caller.token)).send(body);
}

async function raise(caller: { token: string }, body: object = point()) {
  const res = await sos(caller, body);
  expectStatus(res, 201);
  trackForCleanup("sosIncidents", { id: res.body.data.id });
  return res.body.data as { id: string; userId: string; status: string };
}

function move(admin: { token: string }, id: string, body: object) {
  return api.patch(`/admin/safety/incidents/${id}`).set(auth(admin.token)).send(body);
}

function cancel(caller: { token: string }, id: string, body?: object) {
  const req = api.patch(`/safety/sos/${id}/cancel`).set(auth(caller.token));
  return body ? req.send(body) : req;
}

function adminView(id: string, admin: { token: string } = dispatcher) {
  return api.get(`/admin/safety/incidents/${id}`).set(auth(admin.token));
}

const deskEvents = (event: string, incidentId: string) =>
  vi
    .mocked(emitToSafetyDesk)
    .mock.calls.filter(
      ([name, payload]) =>
        name === event && (payload as { incidentId: string }).incidentId === incidentId,
    );

const userEvents = (userId: string, event: string, incidentId: string) =>
  vi
    .mocked(emitToUser)
    .mock.calls.filter(
      ([to, name, payload]) =>
        to === userId &&
        name === event &&
        (payload as { incidentId: string }).incidentId === incidentId,
    );

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  const [admins, shared, riderOnTrip] = await Promise.all([
    Promise.all([
      createSignedInAdmin(superAdmin.token, { sos: { read: true, update: true } }),
      createSignedInAdmin(superAdmin.token, { sos: { read: true } }),
      createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
      createSignedInAdmin(superAdmin.token, {
        users: { create: true, read: true, update: true, delete: true },
      }),
    ]),
    bookableCommute(),
    bookingRider(0),
  ]);
  [dispatcher, reader, outsiderAdmin, usersAdmin] = admins;
  tripDriver = shared.driver;
  tripRider = riderOnTrip;
  trip = await insertTrip(shared.commute, riderOnTrip.userId, { status: "accepted" });
});

describe("POST /safety/sos", () => {
  it("lets a rider raise an alert, snapshots their contacts and alerts the safety desk", async () => {
    const rider = await newRider();
    const contact = {
      name: "Ama Mensah",
      phoneCountryCode: data.GHANA_COUNTRY_CODE,
      phoneNumber: data.ghanaPhoneNumber(),
      relationship: "Sister",
    };
    const added = await api.post("/emergency-contacts").set(auth(rider.token)).send(contact);
    expectStatus(added, 201);
    trackForCleanup("emergencyContacts", { id: added.body.data.id });

    const res = await sos(rider);

    expectStatus(res, 201);
    trackForCleanup("sosIncidents", { id: res.body.data.id });
    expect(res.body.message).toBe("Emergency SOS alert triggered successfully");
    expect(res.body.data).toMatchObject({
      userId: rider.userId,
      role: "rider",
      status: "triggered",
      latitude: 5.60372,
      longitude: -0.17837,
      address: point().address,
      reason: point().reason,
      tripId: null,
    });
    expect(res.body.data.emergencyContactsSnapshot).toEqual([
      expect.objectContaining({ name: "Ama Mensah", relationship: "Sister" }),
    ]);
    // Operations' side of the record isn't the person's to see.
    expect(res.body.data).not.toHaveProperty("resolutionNotes");
    expect(res.body.data).not.toHaveProperty("resolvedByAdminId");

    const alerts = deskEvents("sos:triggered", res.body.data.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({
      incidentId: res.body.data.id,
      userId: rider.userId,
      role: "rider",
      status: "triggered",
      latitude: 5.60372,
      longitude: -0.17837,
    });
    // The alert says where; names, phones and contacts stay behind the admin endpoint.
    expect(alerts[0][1]).not.toHaveProperty("emergencyContactsSnapshot");
  });

  it("lets a driver raise an alert", async () => {
    const driver = await signUpByPhone("driver");

    const incident = await raise(driver);

    expect(incident).toMatchObject({ userId: driver.userId, role: "driver", status: "triggered" });
  });

  it("gives back the alert already raised instead of a second one, and alerts nobody twice", async () => {
    const rider = await newRider();
    const first = await raise(rider);

    const again = await sos(rider, { ...point(), latitude: 5.7 });

    expectStatus(again, 200);
    expect(again.body.message).toBe("An SOS alert is already active");
    expect(again.body.data.id).toBe(first.id);
    expect(await db("sosIncidents").where({ userId: rider.userId })).toHaveLength(1);
    expect(deskEvents("sos:triggered", first.id)).toHaveLength(1);
  });

  it("raises one alert when the button is pressed twice at once", async () => {
    const rider = await newRider();

    const [a, b] = await Promise.all([sos(rider), sos(rider)]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    trackForCleanup("sosIncidents", { id: a.body.data.id });
    expect(await db("sosIncidents").where({ userId: rider.userId })).toHaveLength(1);
    expect(deskEvents("sos:triggered", a.body.data.id)).toHaveLength(1);
  });

  it("can be raised again once the last alert is closed", async () => {
    const rider = await newRider();
    const first = await raise(rider);
    expectStatus(await cancel(rider, first.id), 200);

    const second = await raise(rider);

    expect(second.id).not.toBe(first.id);
  });

  it("links the alert to the caller's own trip", async () => {
    const incident = await raise(tripRider, { ...point(), tripId: trip.id });

    const view = await adminView(incident.id);

    expect(view.body.data.tripId).toBe(trip.id);
  });

  it("refuses a trip that doesn't exist, and someone else's trip", async () => {
    const stranger = await newRider();
    const missing = randomUUID();

    const unknown = await sos(stranger, { ...point(), tripId: missing });
    const notTheirs = await sos(stranger, { ...point(), tripId: trip.id });

    expectStatus(unknown, 400);
    expect(unknown.body.error).toBe(`Trip not found: ${missing}`);
    expectStatus(notTheirs, 403);
    expect(notTheirs.body.error).toBe("You aren't on that trip");
    expect(await db("sosIncidents").where({ userId: stranger.userId })).toHaveLength(0);
    expect(tripDriver.userId).toBeDefined();
  });

  it("is for riders and drivers, not admins", async () => {
    const res = await sos(dispatcher);

    expectStatus(res, 403);
    expect(res.body.error).toBe("Only riders and drivers can raise an SOS alert");
    expect(await db("sosIncidents").where({ userId: dispatcher.userId })).toHaveLength(0);
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.post("/safety/sos").send(point()), 401);
  });

  it.each([
    ["latitude above 90", { latitude: 91, longitude: 0 }],
    ["latitude below -90", { latitude: -91, longitude: 0 }],
    ["longitude above 180", { latitude: 0, longitude: 181 }],
    ["longitude below -180", { latitude: 0, longitude: -181 }],
    ["missing coordinates", {}],
    ["a tripId that isn't a uuid", { ...point(), tripId: "nope" }],
  ])("rejects %s", async (_name, body) => {
    expectStatus(await sos(tripRider, body), 400);
  });
});

describe("GET /safety/sos/active", () => {
  it("returns the alert in play, without operations' notes", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(
      await move(dispatcher, incident.id, {
        status: "underReview",
        resolutionNotes: "Internal: caller sounds calm",
      }),
      200,
    );

    const res = await api.get("/safety/sos/active").set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ id: incident.id, status: "underReview" });
    expect(res.body.data).not.toHaveProperty("resolutionNotes");
    expect(res.body.data).not.toHaveProperty("resolvedByAdminId");
  });

  it("returns null for someone with no alert, and once theirs is closed", async () => {
    const rider = await newRider();
    const none = await api.get("/safety/sos/active").set(auth(rider.token));
    const incident = await raise(rider);
    expectStatus(await cancel(rider, incident.id), 200);

    const closed = await api.get("/safety/sos/active").set(auth(rider.token));

    expectStatus(none, 200);
    expect(none.body.data).toBeNull();
    expect(closed.body.data).toBeNull();
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.get("/safety/sos/active"), 401);
  });
});

describe("PATCH /safety/sos/:id/cancel", () => {
  it("lets the person cancel their alert, and tells the safety desk", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    const res = await cancel(rider, incident.id, {
      cancellationReason: "All clear, pressed by accident",
    });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "cancelledByUser" });
    expect(res.body.data.resolvedAt).not.toBeNull();
    expect(res.body.data).not.toHaveProperty("resolutionNotes");
    expect(deskEvents("sos:cancelled", incident.id)).toHaveLength(1);
    const staff = await adminView(incident.id);
    expect(staff.body.data.resolutionNotes).toBe("All clear, pressed by accident");
  });

  it("works with no body at all", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    const res = await cancel(rider, incident.id);

    expectStatus(res, 200);
    expect((await adminView(incident.id)).body.data.resolutionNotes).toBe(
      "Cancelled by user (false alarm)",
    );
  });

  it("keeps what operations wrote when the person doesn't give a reason", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(
      await move(dispatcher, incident.id, {
        status: "underReview",
        resolutionNotes: "Operator calling rider",
      }),
      200,
    );

    expectStatus(await cancel(rider, incident.id), 200);

    expect((await adminView(incident.id)).body.data.resolutionNotes).toBe("Operator calling rider");
  });

  it("doesn't let anyone else cancel it — not another user, not an admin", async () => {
    const rider = await newRider();
    const other = await newRider();
    const incident = await raise(rider);

    const byUser = await cancel(other, incident.id);
    const byAdmin = await cancel(dispatcher, incident.id);

    for (const res of [byUser, byAdmin]) {
      expectStatus(res, 403);
      expect(res.body.error).toBe("Only the person who raised the alert can cancel it");
    }
    expect((await adminView(incident.id)).body.data.status).toBe("triggered");
  });

  it("is refused once emergency services have been contacted", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(await move(dispatcher, incident.id, { status: "servicesContacted" }), 200);

    const res = await cancel(rider, incident.id);

    expectStatus(res, 409);
    expect(res.body.error).toBe(
      "Emergency services have already been contacted, so only operations can close this alert",
    );
    expect((await adminView(incident.id)).body.data.status).toBe("servicesContacted");
  });

  it("is refused for an alert that is already closed", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(await cancel(rider, incident.id), 200);

    const again = await cancel(rider, incident.id);

    expectStatus(again, 409);
    expect(again.body.error).toBe("Can't cancel an SOS alert that is cancelledByUser");
  });

  it("lets exactly one win when a cancel and a dispatcher's update arrive together", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    const [byUser, byAdmin] = await Promise.all([
      cancel(rider, incident.id),
      move(dispatcher, incident.id, { status: "servicesContacted" }),
    ]);

    expect([byUser.status, byAdmin.status].sort()).toEqual([200, 409]);
    const final = (await adminView(incident.id)).body.data.status;
    expect(final).toBe(byUser.status === 200 ? "cancelledByUser" : "servicesContacted");
  });

  it("404s for an unknown alert, 400s for a bad id, and needs a signed-in user", async () => {
    const rider = await newRider();
    const id = randomUUID();

    const missing = await cancel(rider, id);

    expectStatus(missing, 404);
    expect(missing.body.error).toBe(`SOS incident not found: ${id}`);
    expectStatus(await cancel(rider, "nope"), 400);
    expectStatus(await api.patch(`/safety/sos/${id}/cancel`), 401);
  });
});

describe("GET /admin/safety/incidents", () => {
  it("lists alerts newest first with the person's name and phone, in pages", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    const res = await api
      .get("/admin/safety/incidents")
      .query({ userId: rider.userId, limit: 5 })
      .set(auth(reader.token));

    expectStatus(res, 200);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 5, totalItems: 1, totalPages: 1 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      id: incident.id,
      status: "triggered",
      latitude: 5.60372,
      userFullName: rider.fullName,
      userPhone: `${rider.phoneCountryCode}${rider.phoneNumber}`,
    });
    expect(res.body.data.items[0]).not.toHaveProperty("userPhoneNumber");
  });

  it("filters by status", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(await move(dispatcher, incident.id, { status: "underReview" }), 200);

    const reviewing = await api
      .get("/admin/safety/incidents")
      .query({ userId: rider.userId, status: "underReview" })
      .set(auth(reader.token));
    const triggered = await api
      .get("/admin/safety/incidents")
      .query({ userId: rider.userId, status: "triggered" })
      .set(auth(reader.token));

    expect(reviewing.body.data.items).toHaveLength(1);
    expect(triggered.body.data.items).toHaveLength(0);
  });

  it("rejects an unknown status filter, such as the old snake_case spelling", async () => {
    const res = await api
      .get("/admin/safety/incidents")
      .query({ status: "under_review" })
      .set(auth(reader.token));

    expectStatus(res, 400);
  });

  it("is closed to riders and to admins without sos: read, even with full users access", async () => {
    const rider = await newRider();

    expectStatus(await api.get("/admin/safety/incidents").set(auth(rider.token)), 403);
    for (const admin of [outsiderAdmin, usersAdmin]) {
      const refused = await api.get("/admin/safety/incidents").set(auth(admin.token));
      expectStatus(refused, 403);
      expect(refused.body.error).toBe("Missing permission: read on sos");
    }
  });
});

describe("GET /admin/safety/incidents/:id", () => {
  it("shows the full incident, with the contacts snapshot, and records the view", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    const res = await adminView(incident.id, reader);
    await flushActivityLogs();

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      id: incident.id,
      userFullName: rider.fullName,
      userPhone: `${rider.phoneCountryCode}${rider.phoneNumber}`,
      resolvedByAdminId: null,
      resolutionNotes: null,
    });
    expect(Array.isArray(res.body.data.emergencyContactsSnapshot)).toBe(true);
    const logged = await db("activityLogs").where({ action: "sos.view", targetId: incident.id });
    expect(logged).toHaveLength(1);
    expect(logged[0].actorId).toBe(reader.userId);
  });

  it("404s for an unknown incident and is closed to riders", async () => {
    const rider = await newRider();
    const id = randomUUID();

    const missing = await adminView(id);

    expectStatus(missing, 404);
    expect(missing.body.error).toBe(`SOS incident not found: ${id}`);
    expectStatus(await adminView(id, rider), 403);
  });
});

describe("PATCH /admin/safety/incidents/:id", () => {
  it("moves an alert through review and services to resolved, telling the person and the desk each time", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    for (const status of ["underReview", "servicesContacted"] as const) {
      const step = await move(dispatcher, incident.id, {
        status,
        resolutionNotes: `Now ${status}`,
      });
      expectStatus(step, 200);
      expect(step.body.data).toMatchObject({
        status,
        resolutionNotes: `Now ${status}`,
        resolvedAt: null,
        resolvedByAdminId: null,
      });
    }
    const done = await move(dispatcher, incident.id, {
      status: "resolved",
      resolutionNotes: "Rider confirmed safely assisted",
    });

    expectStatus(done, 200);
    expect(done.body.data).toMatchObject({
      status: "resolved",
      resolvedByAdminId: dispatcher.userId,
      resolutionNotes: "Rider confirmed safely assisted",
    });
    expect(done.body.data.resolvedAt).not.toBeNull();
    for (const status of ["underReview", "servicesContacted", "resolved"]) {
      const toPerson = userEvents(rider.userId, "sos:statusChanged", incident.id).filter(
        ([, , payload]) => (payload as { status: string }).status === status,
      );
      expect(toPerson).toHaveLength(1);
    }
    expect(deskEvents("sos:statusChanged", incident.id)).toHaveLength(3);
    // Operations' notes never go to the person.
    expect(
      JSON.stringify(userEvents(rider.userId, "sos:statusChanged", incident.id)),
    ).not.toContain("Rider confirmed");
  });

  it("lets a step be skipped, and notes be added without changing the status", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(await move(dispatcher, incident.id, { status: "underReview" }), 200);

    const again = await move(dispatcher, incident.id, {
      status: "underReview",
      resolutionNotes: "Still trying to reach them",
    });
    const jump = await move(dispatcher, incident.id, { status: "resolved" });

    expectStatus(again, 200);
    expect(again.body.data.resolutionNotes).toBe("Still trying to reach them");
    expectStatus(jump, 200);
    expect(jump.body.data.status).toBe("resolved");
  });

  it("never moves an alert backwards", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(await move(dispatcher, incident.id, { status: "servicesContacted" }), 200);

    const back = await move(dispatcher, incident.id, { status: "underReview" });

    expectStatus(back, 409);
    expect(back.body.error).toBe("Can't move an SOS alert from servicesContacted to underReview");
  });

  it("can't reopen a resolved alert or touch a cancelled one", async () => {
    const [resolvedRider, cancelledRider] = await Promise.all([newRider(), newRider()]);
    const resolved = await raise(resolvedRider);
    const cancelled = await raise(cancelledRider);
    expectStatus(await move(dispatcher, resolved.id, { status: "resolved" }), 200);
    expectStatus(await cancel(cancelledRider, cancelled.id), 200);

    const reopen = await move(dispatcher, resolved.id, { status: "underReview" });
    const touch = await move(dispatcher, cancelled.id, { status: "underReview" });
    const resolveCancelled = await move(dispatcher, cancelled.id, { status: "resolved" });

    expectStatus(reopen, 409);
    expect(reopen.body.error).toBe("Can't move an SOS alert from resolved to underReview");
    expectStatus(touch, 409);
    expectStatus(resolveCancelled, 409);
    expect((await adminView(cancelled.id)).body.data).toMatchObject({
      status: "cancelledByUser",
      resolvedByAdminId: null,
    });
  });

  it("needs sos: update", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    for (const admin of [reader, outsiderAdmin, usersAdmin]) {
      const res = await move(admin, incident.id, { status: "resolved" });
      expectStatus(res, 403);
    }
    expectStatus(await move(rider, incident.id, { status: "resolved" }), 403);
    expect((await adminView(incident.id)).body.data.status).toBe("triggered");
  });

  it.each([
    ["the old snake_case spelling", { status: "under_review" }],
    ["triggered, which is only where an alert starts", { status: "triggered" }],
    ["cancelledByUser, which only the person can set", { status: "cancelledByUser" }],
    ["cancelledByAdmin, which has its own cancel route", { status: "cancelledByAdmin" }],
    ["no status", {}],
  ])("rejects %s", async (_name, body) => {
    const rider = await newRider();
    const incident = await raise(rider);

    expectStatus(await move(dispatcher, incident.id, body), 400);
  });

  it("404s for an unknown incident", async () => {
    const id = randomUUID();

    const res = await move(dispatcher, id, { status: "resolved" });

    expectStatus(res, 404);
    expect(res.body.error).toBe(`SOS incident not found: ${id}`);
  });
});

// Staff act on alerts without the person being signed in, so most of these tests use an account an admin created
// and an alert written straight in: sign-ups are rate limited per test file.
async function seedIncident(status = "triggered") {
  const person = await createPhoneAccount(superAdmin.token, "rider");
  const [row] = await db("sosIncidents")
    .insert({ userId: person.id, role: "rider", status, latitude: 5.60372, longitude: -0.17837 })
    .returning("id");
  trackForCleanup("sosIncidents", { id: row.id });
  return { id: row.id as string, userId: person.id };
}

function adminCancel(admin: { token: string }, id: string, body?: object) {
  const req = api.patch(`/admin/safety/incidents/${id}/cancel`).set(auth(admin.token));
  return body ? req.send(body) : req;
}

describe("PATCH /admin/safety/incidents/:id/cancel", () => {
  it("lets staff call an alert off, recording who and why, and tells the person and the desk", async () => {
    const incident = await seedIncident();

    const res = await adminCancel(dispatcher, incident.id, {
      resolutionNotes: "Test alert from the QA phone",
    });

    expectStatus(res, 200);
    expect(res.body.message).toBe("SOS incident cancelled successfully");
    expect(res.body.data).toMatchObject({
      id: incident.id,
      status: "cancelledByAdmin",
      resolvedByAdminId: dispatcher.userId,
      resolutionNotes: "Test alert from the QA phone",
    });
    expect(res.body.data.resolvedAt).not.toBeNull();
    expect(userEvents(incident.userId, "sos:statusChanged", incident.id)).toMatchObject([
      [incident.userId, "sos:statusChanged", { incidentId: incident.id, status: "cancelledByAdmin" }],
    ]);
    expect(deskEvents("sos:cancelled", incident.id)).toHaveLength(1);
    expect((await adminView(incident.id)).body.data.status).toBe("cancelledByAdmin");
  });

  it("is no longer in play for the person, who can raise a new alert", async () => {
    const rider = await newRider();
    const incident = await raise(rider);
    expectStatus(await adminCancel(dispatcher, incident.id), 200);

    const active = await api.get("/safety/sos/active").set(auth(rider.token));
    const again = await sos(rider);

    expect(active.body.data).toBeNull();
    expectStatus(again, 201);
    trackForCleanup("sosIncidents", { id: again.body.data.id });
    expect(again.body.data.id).not.toBe(incident.id);
  });

  it.each(["triggered", "underReview", "servicesContacted"])(
    "works from %s, including after emergency services were contacted, when the person no longer can",
    async (from) => {
      const incident = await seedIncident();
      if (from !== "triggered") expectStatus(await move(dispatcher, incident.id, { status: from }), 200);

      const res = await adminCancel(dispatcher, incident.id);

      expectStatus(res, 200);
      expect(res.body.data.status).toBe("cancelledByAdmin");
    },
  );

  it("keeps the notes operations already wrote unless a reason is given now", async () => {
    const [kept, replaced] = await Promise.all([seedIncident(), seedIncident()]);
    await move(dispatcher, kept.id, { status: "underReview", resolutionNotes: "Calling the driver" });
    await move(dispatcher, replaced.id, { status: "underReview", resolutionNotes: "Calling the driver" });

    expectStatus(await adminCancel(dispatcher, kept.id), 200);
    expectStatus(await adminCancel(dispatcher, replaced.id, { resolutionNotes: "Driver confirmed a false alarm" }), 200);

    expect((await adminView(kept.id)).body.data.resolutionNotes).toBe("Calling the driver");
    expect((await adminView(replaced.id)).body.data.resolutionNotes).toBe("Driver confirmed a false alarm");
  });

  it("is refused for an alert that is already over, saying what it is", async () => {
    const [resolved, byUser, byAdmin] = await Promise.all([
      seedIncident("resolved"),
      seedIncident("cancelledByUser"),
      seedIncident(),
    ]);
    expectStatus(await adminCancel(dispatcher, byAdmin.id), 200);

    for (const [incident, status] of [
      [resolved, "resolved"],
      [byUser, "cancelledByUser"],
      [byAdmin, "cancelledByAdmin"],
    ] as const) {
      const res = await adminCancel(dispatcher, incident.id);

      expectStatus(res, 409);
      expect(res.body.error).toBe(`Can't cancel an SOS alert that is ${status}`);
    }
  });

  it("leaves a cancelled alert alone: the status route can't move it", async () => {
    const incident = await seedIncident();
    expectStatus(await adminCancel(dispatcher, incident.id), 200);

    const res = await move(dispatcher, incident.id, { status: "resolved" });

    expectStatus(res, 409);
    expect(res.body.error).toBe("Can't move an SOS alert from cancelledByAdmin to resolved");
  });

  it("lets exactly one win when staff cancel and the person cancels together", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    const [byAdmin, byUser] = await Promise.all([
      adminCancel(dispatcher, incident.id),
      cancel(rider, incident.id),
    ]);

    expect([byAdmin.status, byUser.status].sort()).toEqual([200, 409]);
    const final = (await adminView(incident.id)).body.data.status;
    expect(final).toBe(byAdmin.status === 200 ? "cancelledByAdmin" : "cancelledByUser");
  });

  it("lets exactly one win when staff cancel and another dispatcher resolves together", async () => {
    const incident = await seedIncident();

    const [cancelled, resolved] = await Promise.all([
      adminCancel(dispatcher, incident.id),
      move(dispatcher, incident.id, { status: "resolved" }),
    ]);

    expect([cancelled.status, resolved.status].sort()).toEqual([200, 409]);
    const final = (await adminView(incident.id)).body.data.status;
    expect(final).toBe(cancelled.status === 200 ? "cancelledByAdmin" : "resolved");
  });

  it("shows up in the list when filtering by its status", async () => {
    const incident = await seedIncident();
    expectStatus(await adminCancel(dispatcher, incident.id), 200);

    const res = await api
      .get(`/admin/safety/incidents?status=cancelledByAdmin&userId=${incident.userId}`)
      .set(auth(dispatcher.token));

    expectStatus(res, 200);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([incident.id]);
  });

  it("is recorded in the audit trail with the status it changed from and to", async () => {
    const incident = await seedIncident();
    await adminCancel(dispatcher, incident.id, { resolutionNotes: "Duplicate" });

    await flushActivityLogs();
    const [entry] = await db("activityLogs").where({
      action: "sos.adminCancel",
      targetId: incident.id,
    });

    expect(entry).toMatchObject({ module: "sos", actorId: dispatcher.userId });
    expect(entry.before.status).toBe("triggered");
    expect(entry.after.status).toBe("cancelledByAdmin");
    expect(entry.changedFields).toEqual(expect.arrayContaining(["status", "resolvedByAdminId"]));
  });

  it("needs sos: update, and is not for riders", async () => {
    const [incident, rider] = [await seedIncident(), await newRider()];

    for (const caller of [reader, outsiderAdmin, usersAdmin, rider]) {
      expectStatus(await adminCancel(caller, incident.id), 403);
    }
    const anonymous = await api.patch(`/admin/safety/incidents/${incident.id}/cancel`);
    expectStatus(anonymous, 401);
    expect((await adminView(incident.id)).body.data.status).toBe("triggered");
  });

  it("404s for an unknown alert, and 400s for a bad id or notes that are too long", async () => {
    const id = randomUUID();
    const incident = await seedIncident();

    const missing = await adminCancel(dispatcher, id);
    const badId = await adminCancel(dispatcher, "not-a-uuid");
    const tooLong = await adminCancel(dispatcher, incident.id, { resolutionNotes: "x".repeat(2001) });

    expectStatus(missing, 404);
    expect(missing.body.error).toBe(`SOS incident not found: ${id}`);
    expectStatus(badId, 400);
    expectStatus(tooLong, 400);
  });
});

describe("the safety desk room", () => {
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

  it("admits admins who can read sos, and only them", async () => {
    const rider = await newRider();

    expect(await joined(reader.userId, "admin")).toEqual([`user:${reader.userId}`, "admin:safety"]);
    expect(await joined(dispatcher.userId, "admin")).toContain("admin:safety");
    expect(await joined(outsiderAdmin.userId, "admin")).toEqual([`user:${outsiderAdmin.userId}`]);
    expect(await joined(usersAdmin.userId, "admin")).toEqual([`user:${usersAdmin.userId}`]);
    expect(await joined(rider.userId, "user")).toEqual([`user:${rider.userId}`]);
  });
});
