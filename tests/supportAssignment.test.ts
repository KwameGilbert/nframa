import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { emitToSupportDesk, emitToUser } from "../src/services/socket.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createRole,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { seedCategory, seedMessage, seedTicket } from "./helpers/support.js";
import { insertTrip, newCommute } from "./helpers/trips.js";

type Session = { userId: string; token: string };

let agent: Session; // support: create, read, update
let agent2: Session; // support: read, update
let solo: Session; // support: read, update; only the stats test assigns to them
let reader: Session; // support: read
let outsider: Session; // no support access
let suspendedAgentId: string;
let rider: Session & { phoneCountryCode: string; phoneNumber: string };
let driver: Session;
let category: { id: string; name: string };

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  const agentRole = await createRole(superAdmin.token, { support: { read: true, update: true } });
  [agent, agent2, solo, reader, outsider, rider, driver, category] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { support: { create: true, read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { support: { read: true } }),
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    signUpByPhone("rider"),
    signUpByPhone("driver"),
    seedCategory(),
  ]);
  suspendedAgentId = (await createAdminAccount(superAdmin.token, { roleId: agentRole.id, status: "suspended" }))
    .userId;
});

const assign = (caller: Session, id: string, body?: object) => {
  const req = api.post(`/admin/support/tickets/${id}/assign`).set(auth(caller.token));
  return body ? req.send(body) : req;
};
const unassign = (caller: Session, id: string) =>
  api.post(`/admin/support/tickets/${id}/unassign`).set(auth(caller.token));
const patch = (caller: Session, id: string, body: object) =>
  api.patch(`/admin/support/tickets/${id}`).set(auth(caller.token)).send(body);
const queue = (caller: Session, query = "") =>
  api.get(`/admin/support/tickets${query}`).set(auth(caller.token));

const events = (ticketId: string, eventType?: string) =>
  db("supportTicketMessages")
    .where({ ticketId, kind: "event", ...(eventType && { eventType }) })
    .orderBy("seq");

describe("POST /admin/support/tickets/:id/assign", () => {
  it("takes an open ticket, starting it, with an internal event the raiser never sees", async () => {
    const ticket = await seedTicket(rider.userId, category.id);

    const res = await assign(agent, ticket.id);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "inProgress", assignee: { id: agent.userId } });

    const [event] = await events(ticket.id, "assigned");
    expect(event).toMatchObject({
      internal: true,
      eventData: { adminId: agent.userId, previousAdminId: null, byAdminId: agent.userId },
    });
    const toRider = vi
      .mocked(emitToUser)
      .mock.calls.filter(([to, name]) => to === rider.userId && name === "support:ticketUpdated")
      .at(-1)?.[2] as { ticket: object; events: unknown[] };
    expect(toRider.events).toEqual([]);
    expect(toRider.ticket).toMatchObject({ id: ticket.id, status: "inProgress" });
    expect(JSON.stringify(toRider)).not.toContain(agent.userId);
    expect(vi.mocked(emitToSupportDesk)).toHaveBeenCalledWith(
      "support:ticketUpdated",
      expect.objectContaining({ ticket: expect.objectContaining({ id: ticket.id }) }),
    );

    await flushActivityLogs();
    const logged = await db("activityLogs").where({ action: "support.ticket.assign", targetId: ticket.id });
    expect(logged).toHaveLength(1);
  });

  it("gives it to another agent and takes it over, naming who had it; the same agent again is a no-op", async () => {
    const ticket = await seedTicket(rider.userId, category.id);

    expectStatus(await assign(agent, ticket.id, { adminId: agent2.userId }), 200);
    const taken = await assign(agent, ticket.id);
    expect(taken.body.data.assignee.id).toBe(agent.userId);
    expectStatus(await assign(agent, ticket.id), 200);

    const assigned = await events(ticket.id, "assigned");
    expect(assigned.map((e) => e.eventData)).toEqual([
      expect.objectContaining({ adminId: agent2.userId, previousAdminId: null, byAdminId: agent.userId }),
      expect.objectContaining({ adminId: agent.userId, previousAdminId: agent2.userId }),
    ]);
  });

  it("refuses agents who can't take tickets, and callers without support: update", async () => {
    const ticket = await seedTicket(rider.userId, category.id);
    for (const adminId of [reader.userId, suspendedAgentId, randomUUID()]) {
      expectError(await assign(agent, ticket.id, { adminId }), 400, "That admin can't take support tickets");
    }
    expectError(await assign(reader, ticket.id), 403, "Missing permission: update on support");
    expectStatus(await assign(agent, randomUUID()), 404);
  });

  it("leaves a closed ticket alone", async () => {
    const ticket = await seedTicket(rider.userId, category.id, { status: "closed", closedAt: new Date() });
    expectError(await assign(agent, ticket.id), 409, "This ticket is closed");
    expectError(await unassign(agent, ticket.id), 409, "This ticket is closed");
  });
});

describe("POST /admin/support/tickets/:id/unassign", () => {
  it("puts an in-progress ticket back to open; already unassigned changes nothing", async () => {
    const ticket = await seedTicket(rider.userId, category.id, {
      status: "inProgress",
      assignedAdminId: agent2.userId,
    });

    const res = await unassign(agent, ticket.id);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "open", assignee: null });
    expectStatus(await unassign(agent, ticket.id), 200);
    const [event, ...more] = await events(ticket.id, "unassigned");
    expect(more).toEqual([]);
    expect(event).toMatchObject({ internal: true, eventData: { previousAdminId: agent2.userId } });
  });
});

describe("PATCH /admin/support/tickets/:id", () => {
  it("resolves with a public event, and records details in one internal event", async () => {
    const ticket = await seedTicket(rider.userId, category.id, { status: "inProgress" });

    const res = await patch(agent, ticket.id, { status: "resolved", priority: "urgent", subject: "Double charge" });
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "resolved", priority: "urgent", subject: "Double charge" });
    expect(res.body.data.resolvedAt).not.toBeNull();

    const [status, details] = await events(ticket.id);
    expect(status).toMatchObject({
      eventType: "statusChanged",
      internal: false,
      eventData: { from: "inProgress", to: "resolved", byAdminId: agent.userId },
    });
    expect(details).toMatchObject({
      eventType: "detailsChanged",
      internal: true,
      eventData: { changes: { priority: { from: "normal", to: "urgent" }, subject: expect.any(Object) } },
    });
  });

  it("reopening a resolved ticket clears its resolution and rating", async () => {
    const ticket = await seedTicket(rider.userId, category.id, {
      status: "resolved",
      resolvedAt: new Date(),
      rating: 2,
      ratedAt: new Date(),
    });
    const res = await patch(agent, ticket.id, { status: "inProgress" });
    expect(res.body.data).toMatchObject({ resolvedAt: null, rating: null, ratedAt: null });
  });

  it("keeps closed final but lets its details be corrected", async () => {
    const ticket = await seedTicket(rider.userId, category.id, { status: "closed", closedAt: new Date() });
    expectError(await patch(agent, ticket.id, { status: "open" }), 409, "This ticket is closed");
    expectStatus(await patch(agent, ticket.id, { priority: "low" }), 200);
  });

  it("refuses an inactive category, an empty body and a reader", async () => {
    const ticket = await seedTicket(rider.userId, category.id);
    const inactive = await seedCategory({ isActive: false });
    expectError(await patch(agent, ticket.id, { categoryId: inactive.id }), 400, "That support category isn't available");
    expectError(await patch(agent, ticket.id, {}), 400, "At least one field must be provided");
    expectError(await patch(reader, ticket.id, { priority: "low" }), 403, "Missing permission: update on support");
    expect(await events(ticket.id)).toEqual([]);
  });
});

describe("GET /admin/support/tickets/:id", () => {
  it("shows the raiser, the linked trip without its boarding code, the related ticket and history, and records the view", async () => {
    const { commute } = await newCommute();
    const trip = await insertTrip(commute, rider.userId, { status: "completed" });
    const earlier = await seedTicket(rider.userId, category.id, { status: "closed", closedAt: new Date() });
    const ticket = await seedTicket(rider.userId, category.id, { tripId: trip.id, relatedTicketId: earlier.id });

    const res = await api.get(`/admin/support/tickets/${ticket.id}`).set(auth(reader.token));
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      raiser: {
        id: rider.userId,
        role: "rider",
        phoneNumber: `${rider.phoneCountryCode}${rider.phoneNumber}`,
        status: "active",
        deleted: false,
      },
      trip: { id: trip.id, status: "completed" },
      relatedTicket: { id: earlier.id, code: earlier.code, status: "closed" },
    });
    expect(res.body.data.history.totalTickets).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toContain(trip.boardingCode);

    await flushActivityLogs();
    const [view] = await db("activityLogs").where({ action: "support.ticket.view", targetId: ticket.id });
    expect(view).toMatchObject({ module: "support", actorId: reader.userId });
  });

  it("404s for an unknown ticket and needs support: read", async () => {
    const id = randomUUID();
    expectError(
      await api.get(`/admin/support/tickets/${id}`).set(auth(reader.token)),
      404,
      `Support ticket not found: ${id}`,
    );
    expectError(await queue(outsider), 403, "Missing permission: read on support");
  });
});

describe("GET /admin/support/tickets", () => {
  it("orders the queue: active first, then priority, then the longest waiting", async () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    const closedUrgent = await seedTicket(driver.userId, category.id, {
      raiserRole: "driver",
      status: "closed",
      closedAt: new Date(),
      priority: "urgent",
    });
    const oldLow = await seedTicket(driver.userId, category.id, { raiserRole: "driver", priority: "low", lastMessageAt: hoursAgo(9) });
    const urgent = await seedTicket(driver.userId, category.id, { raiserRole: "driver", priority: "urgent" });
    const normalOlder = await seedTicket(driver.userId, category.id, {
      raiserRole: "driver",
      status: "inProgress",
      lastMessageAt: hoursAgo(5),
    });
    const normalNewer = await seedTicket(driver.userId, category.id, { raiserRole: "driver", lastMessageAt: hoursAgo(1) });
    await seedMessage(normalNewer.id, { senderSide: "user", body: "Hello?" });
    await db("supportTickets").where({ id: normalNewer.id }).update({ lastMessageSide: "user" });

    const res = await queue(agent, `?userId=${driver.userId}`);
    expectStatus(res, 200);
    expect(res.body.data.items.map((t: { id: string }) => t.id)).toEqual([
      urgent.id,
      normalOlder.id,
      normalNewer.id,
      oldLow.id,
      closedUrgent.id,
    ]);
    const unread = res.body.data.items.find((t: { id: string }) => t.id === normalNewer.id);
    expect(unread).toMatchObject({ unreadCount: 1, lastMessage: { from: "user", preview: "Hello?" } });

    const filtered = await queue(agent, `?userId=${driver.userId}&priority=urgent&priority=low&status=open`);
    expect(filtered.body.data.items.map((t: { id: string }) => t.id)).toEqual([urgent.id, oldLow.id]);
    const waiting = await queue(agent, `?userId=${driver.userId}&needsReply=true`);
    expect(waiting.body.data.items.map((t: { id: string }) => t.id)).toEqual([normalNewer.id]);
    const newest = await queue(agent, `?userId=${driver.userId}&sort=newest&limit=1`);
    expect(newest.body.data.items[0].id).toBe(normalNewer.id);
    expect(newest.body.data.pagination).toMatchObject({ totalItems: 5, totalPages: 5 });
  });

  it("counts the caller's own active tickets in stats", async () => {
    await seedTicket(rider.userId, category.id, { status: "inProgress", assignedAdminId: solo.userId });
    await seedTicket(rider.userId, category.id, { status: "awaitingUser", assignedAdminId: solo.userId });
    await seedTicket(rider.userId, category.id, { status: "closed", closedAt: new Date(), assignedAdminId: solo.userId });

    const res = await queue(solo, "?assignedTo=me");
    expectStatus(res, 200);
    expect(res.body.data.stats.mine).toBe(2);
    expect(res.body.data.items).toHaveLength(3);
    expect(Object.keys(res.body.data.stats).sort()).toEqual(
      ["awaitingUser", "closed", "inProgress", "mine", "needsReply", "open", "resolved", "unassigned"].sort(),
    );
  });
});

describe("GET /admin/support/assignees", () => {
  it("lists active agents who can update support, with their load", async () => {
    const res = await api.get("/admin/support/assignees").set(auth(reader.token));
    expectStatus(res, 200);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([agent.userId, agent2.userId]));
    expect(ids).not.toContain(reader.userId);
    expect(ids).not.toContain(suspendedAgentId);
    expect(res.body.data.find((a: { id: string }) => a.id === agent.userId).openTickets).toEqual(expect.any(Number));
  });
});

describe("POST /admin/support/tickets", () => {
  const openFor = (caller: Session, body: object) =>
    api.post("/admin/support/tickets").set(auth(caller.token)).send(body);

  it("opens a ticket for a rider, already with the agent, which the rider sees in their app", async () => {
    const res = await openFor(agent, {
      userId: rider.userId,
      categoryId: category.id,
      subject: "Following up on your call",
      message: "As discussed, we're refunding the second charge.",
    });
    expectStatus(res, 201);
    trackForCleanup("supportTickets", { id: res.body.data.id });
    expect(res.body.data).toMatchObject({
      status: "inProgress",
      assignee: { id: agent.userId },
      createdBy: { id: agent.userId },
      lastMessageSide: "staff",
      raiser: { id: rider.userId, role: "rider" },
    });

    const timeline = await db("supportTicketMessages").where({ ticketId: res.body.data.id }).orderBy("seq");
    expect(timeline.map((m) => [m.kind, m.eventType, m.senderSide, m.internal])).toEqual([
      ["event", "opened", "staff", false],
      ["event", "assigned", "staff", true],
      ["message", null, "staff", false],
    ]);

    const mine = await api.get(`/support/tickets/${res.body.data.id}`).set(auth(rider.token));
    expectStatus(mine, 200);
    expect(mine.body.data).toMatchObject({ status: "inProgress", unreadCount: 1 });
    expect(JSON.stringify(mine.body)).not.toContain(agent.userId);
    expect(vi.mocked(emitToUser)).toHaveBeenCalledWith(
      rider.userId,
      "support:ticketCreated",
      expect.objectContaining({ ticket: expect.objectContaining({ id: res.body.data.id }) }),
    );
  });

  it("is only for riders and drivers that exist, and needs support: create", async () => {
    const body = { categoryId: category.id, subject: "Hello there", message: "Hi" };
    expectError(
      await openFor(agent, { ...body, userId: agent2.userId }),
      400,
      "Support tickets can only be opened for riders and drivers",
    );
    const id = randomUUID();
    expectError(await openFor(agent, { ...body, userId: id }), 404, `User not found: ${id}`);
    expectError(
      await openFor(agent2, { ...body, userId: rider.userId }),
      403,
      "Missing permission: create on support",
    );
  });
});

describe("the support desk room", () => {
  it("admits admins who can read support, and only them", async () => {
    const actual = await vi.importActual<typeof import("../src/services/socket.service.js")>(
      "../src/services/socket.service.js",
    );
    const joined = async (userId: string) => {
      const rooms: string[] = [];
      await actual.joinSocketRooms({
        data: { userId, userType: "admin", role: "admin" },
        join: (room) => rooms.push(room),
      });
      return rooms;
    };
    expect(await joined(reader.userId)).toContain("admin:support");
    expect(await joined(outsider.userId)).not.toContain("admin:support");
  });
});
