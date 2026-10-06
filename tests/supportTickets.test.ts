import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { loggableBody, loggableResponse } from "../src/middlewares/httpLogger.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { emitToSupportDesk, emitToUser } from "../src/services/socket.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { REQUEST_ID_PREFIX, trackForCleanup } from "./helpers/cleanup.js";
import { seedCategory, seedMessage, seedTicket, uniqueWord } from "./helpers/support.js";
import { insertTrip, newCommute } from "./helpers/trips.js";

type Session = { userId: string; token: string };
type Category = Awaited<ReturnType<typeof seedCategory>>;

let staff: Session;
let rider: Session;
let stranger: Session; // another rider
let driver: Session;
let category: Category; // everyone, high priority
let driverCategory: Category;

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  [staff, rider, stranger, driver, category, driverCategory] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { support: { read: true } }),
    signUpByPhone("rider"),
    signUpByPhone("rider"),
    signUpByPhone("driver"),
    seedCategory({ defaultPriority: "high" }),
    seedCategory({ audience: "driver" }),
  ]);
});

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

function post(caller: Session, body: object) {
  return api.post("/support/tickets").set(auth(caller.token)).send(body);
}

async function open(caller: Session, body: object = {}) {
  const res = await post(caller, {
    categoryId: category.id,
    subject: `Charged twice ${uniqueWord()}`,
    message: "I was charged twice for this morning's trip.",
    ...body,
  });
  expectStatus(res, 201);
  trackForCleanup("supportTickets", { id: res.body.data.id });
  return res.body.data as { id: string; code: string; status: string; subject: string };
}

const detail = (caller: Session, id: string) => api.get(`/support/tickets/${id}`).set(auth(caller.token));
const list = (caller: Session, query = "") => api.get(`/support/tickets${query}`).set(auth(caller.token));
const resolve = (caller: Session, id: string) =>
  api.post(`/support/tickets/${id}/resolve`).set(auth(caller.token));
const rate = (caller: Session, id: string, body: object) =>
  api.post(`/support/tickets/${id}/rate`).set(auth(caller.token)).send(body);

const timeline = (ticketId: string) =>
  db("supportTicketMessages").where({ ticketId }).orderBy("seq").select("seq", "kind", "eventType", "eventData", "senderSide");

describe("POST /support/tickets", () => {
  it("opens a ticket with a code and the category's priority, its opened event before the first message", async () => {
    const ticket = await open(rider, { priority: "low" });

    expect(ticket.code).toMatch(/^ST-[A-HJ-NP-Z2-9]{6}$/);
    expect(ticket).toMatchObject({
      status: "open",
      category: { id: category.id, name: category.name },
      unreadCount: 0,
      lastMessage: expect.objectContaining({ from: "user", preview: "I was charged twice for this morning's trip." }),
    });
    for (const hidden of ["priority", "assignedAdminId", "createdByAdminId", "detachedAt", "userId"]) {
      expect(ticket).not.toHaveProperty(hidden);
    }

    const row = await db("supportTickets").where({ id: ticket.id }).first();
    expect(row).toMatchObject({ priority: "high", raiserRole: "rider", lastMessageSide: "user" });
    const [opened, first] = await timeline(ticket.id);
    expect(opened).toMatchObject({ kind: "event", eventType: "opened", senderSide: "user" });
    expect(first).toMatchObject({ kind: "message", senderSide: "user" });
    expect(first.seq).toBeGreaterThan(opened.seq);
    expect(row.userLastReadSeq).toBe(first.seq);

    expect(vi.mocked(emitToSupportDesk)).toHaveBeenCalledWith(
      "support:ticketCreated",
      expect.objectContaining({ ticket: expect.objectContaining({ id: ticket.id, priority: "high" }) }),
    );
  });

  it("opens with files only, and never shows where they are stored", async () => {
    const res = await api
      .post("/support/tickets")
      .set(auth(rider.token))
      .field("categoryId", category.id)
      .field("subject", "Screenshot of the charge")
      .attach("attachments", Buffer.from("png"), { filename: "charge.png", contentType: "image/png" })
      .attach("attachments", Buffer.from("m4a"), { filename: "voice.m4a", contentType: "audio/x-m4a" });
    expectStatus(res, 201);
    trackForCleanup("supportTickets", { id: res.body.data.id });

    expect(res.body.data.lastMessage).toMatchObject({ preview: null, attachmentKind: "image" });
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|resourceType/);
    const [, first] = await timeline(res.body.data.id);
    const message = await db("supportTicketMessages").where({ ticketId: res.body.data.id, seq: first.seq }).first();
    expect(message.body).toBeNull();
    expect(message.attachments).toHaveLength(2);
    expect(message.attachments[0].storageKey).toContain(`support/${res.body.data.id}/`);
  });

  it("needs a message or a file, and a category the caller can use", async () => {
    expectError(
      await post(rider, { categoryId: category.id, subject: "Nothing to say" }),
      400,
      "Write a message or attach a file",
    );
    expectError(
      await post(rider, { categoryId: driverCategory.id, subject: "Payout", message: "Hi" }),
      400,
      `Support category not available: ${driverCategory.id}`,
    );
    const inactive = await seedCategory({ isActive: false });
    expectStatus(await post(stranger, { categoryId: inactive.id, subject: "Old", message: "Hi" }), 400);
    expectStatus(await post(stranger, { categoryId: category.id, subject: "Hi", message: "Hi" }), 400);
  });

  it("links the caller's own trip and earlier ticket, and 404s anyone else's", async () => {
    const { commute } = await newCommute();
    const trip = await insertTrip(commute, rider.userId, { status: "completed" });
    const earlier = await seedTicket(rider.userId, category.id, { status: "closed", closedAt: new Date() });

    const linked = await open(rider, { tripId: trip.id, relatedTicketId: earlier.id });
    expect(linked).toMatchObject({ tripId: trip.id, relatedTicketId: earlier.id });

    const theirs = await seedTicket(stranger.userId, category.id);
    expectError(
      await post(stranger, { categoryId: category.id, subject: "Their trip", message: "x", tripId: trip.id }),
      404,
      `Trip not found: ${trip.id}`,
    );
    expectError(
      await post(rider, { categoryId: category.id, subject: "Not mine", message: "x", relatedTicketId: theirs.id }),
      404,
      `Support ticket not found: ${theirs.id}`,
    );
    const id = randomUUID();
    expectError(
      await post(rider, { categoryId: category.id, subject: "Ghost", message: "x", transactionId: id }),
      404,
      `Transaction not found: ${id}`,
    );
    expectError(
      await post(driver, { categoryId: category.id, subject: "Ghost", message: "x", payoutId: id }),
      404,
      `Payout not found: ${id}`,
    );
  });

  it("is for riders and drivers only", async () => {
    expectError(
      await post(staff, { categoryId: category.id, subject: "Staff", message: "x" }),
      403,
      "Only riders and drivers can use support tickets",
    );
  });

  it("is recorded without the subject or message, which never reach the request log either", async () => {
    const secret = `Secret ${uniqueWord()}`;
    const ticket = await open(rider, { subject: secret, message: secret });

    await flushActivityLogs();
    const [entry] = await db("activityLogs")
      .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
      .where({ action: "support.ticket.create", targetId: ticket.id });
    expect(entry).toMatchObject({ module: "support", actorId: rider.userId });
    expect(JSON.stringify(entry)).not.toContain(secret);

    const body = { categoryId: category.id, subject: secret, message: secret };
    expect(JSON.stringify(loggableBody({ originalUrl: "/support/tickets", method: "POST", body }))).not.toContain(secret);
    expect(loggableResponse({ success: true, data: { subject: secret } }, "/support/tickets")).toEqual({
      success: true,
      data: "[REDACTED]",
    });
    expect(loggableResponse({ success: true, data: { subject: secret } }, "/admin/support/tickets/x")).toEqual({
      success: true,
      data: "[REDACTED]",
    });
  });

  it("is rate limited per account", async () => {
    const flooder = await signUpByPhone("rider");
    for (let i = 0; i < 10; i++) await open(flooder);
    expectStatus(await post(flooder, { categoryId: category.id, subject: "Eleventh", message: "x" }), 429);
  });
});

describe("GET /support/tickets", () => {
  it("lists only the caller's tickets, newest activity first, with unread support replies", async () => {
    const [older, newer] = [
      await seedTicket(driver.userId, category.id, { raiserRole: "driver", lastMessageAt: daysAgo(2) }),
      await seedTicket(driver.userId, category.id, { raiserRole: "driver", status: "inProgress" }),
    ];
    await seedTicket(stranger.userId, category.id);
    await seedMessage(newer.id, { body: "We're looking into it." });
    await seedMessage(newer.id, { kind: "note", body: "Internal only" });
    await db("supportTickets").where({ id: newer.id }).update({ userLastReadSeq: 0 });

    const res = await list(driver);
    expectStatus(res, 200);
    const ids = res.body.data.items.map((t: { id: string }) => t.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const shown = res.body.data.items.find((t: { id: string }) => t.id === newer.id);
    expect(shown).toMatchObject({
      unreadCount: 1,
      lastMessage: { from: "support", preview: "We're looking into it.", deleted: false },
    });
    expect(JSON.stringify(res.body)).not.toContain("Internal only");
    expect(ids).not.toContain(undefined);
  });

  it("filters by repeated status and paginates", async () => {
    const [a, b] = await Promise.all([
      seedTicket(stranger.userId, category.id, { status: "awaitingUser" }),
      seedTicket(stranger.userId, category.id, { status: "resolved", resolvedAt: new Date() }),
    ]);
    const res = await list(stranger, "?status=awaitingUser&status=resolved&limit=1");
    expectStatus(res, 200);
    expect(res.body.data.pagination).toMatchObject({ limit: 1, totalItems: 2, totalPages: 2 });
    expect([a.id, b.id]).toContain(res.body.data.items[0].id);
    expectStatus(await list(stranger, "?status=pending"), 400);
  });
});

describe("GET /support/tickets/:id", () => {
  it("shows the caller's ticket and 404s for anyone else", async () => {
    const ticket = await seedTicket(rider.userId, category.id);
    const res = await detail(rider, ticket.id);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ id: ticket.id, canReply: true, reopenUntil: null });

    expectError(await detail(stranger, ticket.id), 404, `Support ticket not found: ${ticket.id}`);
    expectStatus(await detail(rider, "nope"), 400);
  });

  it("auto-resolves a ticket idle on the user's reply, and closes one resolved past the reopen window", async () => {
    const idle = await seedTicket(rider.userId, category.id, {
      status: "awaitingUser",
      lastMessageAt: daysAgo(6),
    });
    const expired = await seedTicket(rider.userId, category.id, {
      status: "resolved",
      resolvedAt: daysAgo(8),
    });

    const resolved = await detail(rider, idle.id);
    expect(resolved.body.data).toMatchObject({ status: "resolved", canReply: true });
    expect(new Date(resolved.body.data.reopenUntil).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    const closed = await detail(rider, expired.id);
    expect(closed.body.data).toMatchObject({ status: "closed", canReply: false, reopenUntil: null });
    expect(closed.body.data.closedAt).not.toBeNull();

    expect((await timeline(idle.id)).at(-1)).toMatchObject({
      eventType: "statusChanged",
      senderSide: "system",
      eventData: { from: "awaitingUser", to: "resolved", reason: "autoResolved" },
    });
    expect((await timeline(expired.id)).at(-1)).toMatchObject({
      eventData: { from: "resolved", to: "closed", reason: "reopenWindowExpired" },
    });
  });
});

describe("POST /support/tickets/:id/resolve and /rate", () => {
  // Seeded rather than opened: every create counts against the raiser's limit of 10.
  it("resolves once, then takes one rating", async () => {
    const ticket = await seedTicket(rider.userId, category.id);

    expectError(await rate(rider, ticket.id, { rating: 5 }), 409, "You can rate a ticket once it is resolved");

    const resolved = await resolve(rider, ticket.id);
    expectStatus(resolved, 200);
    expect(resolved.body.data.status).toBe("resolved");
    expect((await timeline(ticket.id)).at(-1)).toMatchObject({
      eventType: "statusChanged",
      eventData: { from: "open", to: "resolved", reason: "userResolved" },
    });
    expect(vi.mocked(emitToUser)).toHaveBeenCalledWith(
      rider.userId,
      "support:ticketUpdated",
      expect.objectContaining({
        ticket: expect.objectContaining({ id: ticket.id, status: "resolved" }),
        events: [expect.objectContaining({ type: "statusChanged", data: expect.objectContaining({ to: "resolved" }) })],
      }),
    );
    expectError(await resolve(rider, ticket.id), 409, "This ticket is already resolved");

    expectStatus(await rate(rider, ticket.id, { rating: 6 }), 400);
    const rated = await rate(rider, ticket.id, { rating: 4, comment: "Quick help" });
    expectStatus(rated, 200);
    expect(rated.body.data).toMatchObject({ rating: 4, ratingComment: "Quick help" });
    expectError(await rate(rider, ticket.id, { rating: 5 }), 409, "You have already rated this ticket");
  });

  it("404s on someone else's ticket", async () => {
    const ticket = await seedTicket(rider.userId, category.id);
    expectError(await resolve(stranger, ticket.id), 404, `Support ticket not found: ${ticket.id}`);
    expectError(await rate(stranger, ticket.id, { rating: 3 }), 404, `Support ticket not found: ${ticket.id}`);
  });

  it("resolves only once under concurrent requests", async () => {
    const ticket = await seedTicket(rider.userId, category.id);
    const results = await Promise.all([resolve(rider, ticket.id), resolve(rider, ticket.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = (await timeline(ticket.id)).filter((e) => e.eventType === "statusChanged");
    expect(events).toHaveLength(1);
  });
});
