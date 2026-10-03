import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { emitToSafetyDesk, emitToUser } from "../src/services/socket.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { bookableCommute, bookingRider, insertTrip } from "./helpers/trips.js";

type Person = { userId: string; token: string };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let dispatcher: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read, update
let reader: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read only
let outsiderAdmin: Awaited<ReturnType<typeof createSignedInAdmin>>; // no users access
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
      createSignedInAdmin(superAdmin.token, { users: { read: true, update: true } }),
      createSignedInAdmin(superAdmin.token, { users: { read: true } }),
      createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
    ]),
    bookableCommute(),
    bookingRider(0),
  ]);
  [dispatcher, reader, outsiderAdmin] = admins;
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

  it("is closed to riders and to admins without users: read", async () => {
    const rider = await newRider();

    expectStatus(await api.get("/admin/safety/incidents").set(auth(rider.token)), 403);
    const refused = await api.get("/admin/safety/incidents").set(auth(outsiderAdmin.token));
    expectStatus(refused, 403);
    expect(refused.body.error).toBe("Missing permission: read on users");
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

  it("needs users: update", async () => {
    const rider = await newRider();
    const incident = await raise(rider);

    for (const admin of [reader, outsiderAdmin]) {
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

  it("admits admins who can read users, and only them", async () => {
    const rider = await newRider();

    expect(await joined(reader.userId, "admin")).toEqual([`user:${reader.userId}`, "admin:safety"]);
    expect(await joined(dispatcher.userId, "admin")).toContain("admin:safety");
    expect(await joined(outsiderAdmin.userId, "admin")).toEqual([`user:${outsiderAdmin.userId}`]);
    expect(await joined(rider.userId, "user")).toEqual([`user:${rider.userId}`]);
  });
});
