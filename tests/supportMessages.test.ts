import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { emitToUser } from "../src/services/socket.service.js";
import { deleteFile, uploadAttachment } from "../src/services/storage.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { seedCategory, seedMessage, seedTicket, uniqueWord } from "./helpers/support.js";

type Session = { userId: string; token: string; fullName?: string };

let agent: Session; // support: read, update
let moderator: Session; // support: read, update, delete
let rider: Session;
let stranger: Session;
let categoryId: string;

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  let category;
  [agent, moderator, rider, stranger, category] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true, delete: true } }),
    signUpByPhone("rider"),
    signUpByPhone("rider"),
    seedCategory(),
  ]);
  categoryId = category.id;
});

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ticketFor = (over: Record<string, unknown> = {}) =>
  seedTicket(rider.userId, categoryId, over);
const row = (id: string) => db("supportTickets").where({ id }).first();

const say = (caller: Session, id: string, body: object = { body: `Hi ${uniqueWord()}` }) =>
  api.post(`/support/tickets/${id}/messages`).set(auth(caller.token)).send(body);
const staffSay = (
  kind: "messages" | "notes",
  caller: Session,
  id: string,
  body: object = { body: `Re ${uniqueWord()}` },
) => api.post(`/admin/support/tickets/${id}/${kind}`).set(auth(caller.token)).send(body);
const list = (caller: Session, id: string, query = "") =>
  api.get(`/support/tickets/${id}/messages${query}`).set(auth(caller.token));
const staffList = (id: string, query = "") =>
  api.get(`/admin/support/tickets/${id}/messages${query}`).set(auth(agent.token));
const remove = (path: string, caller: Session, id: string, messageId: string) =>
  api.delete(`${path}/${id}/messages/${messageId}`).set(auth(caller.token));

describe("posting", () => {
  it("a staff reply takes an unassigned ticket and waits on the user; the user's reply hands it back", async () => {
    const ticket = await ticketFor();

    const reply = await staffSay("messages", agent, ticket.id, {
      body: "Can you send the receipt?",
    });
    expectStatus(reply, 201);
    expect(await row(ticket.id)).toMatchObject({
      status: "awaitingUser",
      assignedAdminId: agent.userId,
      lastMessageSide: "staff",
    });
    expect((await row(ticket.id)).firstResponseAt).not.toBeNull();
    const [assigned] = await db("supportTicketMessages").where({
      ticketId: ticket.id,
      eventType: "assigned",
    });
    expect(assigned.internal).toBe(true);
    expect(assigned.seq).toBeLessThan(reply.body.data.message.seq);

    expectStatus(await say(rider, ticket.id), 201);
    expect(await row(ticket.id)).toMatchObject({ status: "inProgress", lastMessageSide: "user" });

    const seen = await list(rider, ticket.id);
    const fromSupport = seen.body.data.items.find((m: { from: string }) => m.from === "support");
    expect(fromSupport.senderName).toBe(agent.fullName!.split(" ")[0]);
    expect(seen.body.data.items.some((m: { kind: string }) => m.kind === "event")).toBe(false);
  });

  it("reopens a resolved ticket within the window and clears its rating", async () => {
    const ticket = await ticketFor({
      status: "resolved",
      resolvedAt: ago(DAY),
      rating: 3,
      ratedAt: ago(DAY),
    });

    expectStatus(await say(rider, ticket.id), 201);
    expect(await row(ticket.id)).toMatchObject({
      status: "open",
      resolvedAt: null,
      rating: null,
      ratedAt: null,
    });
    const [event] = await db("supportTicketMessages").where({
      ticketId: ticket.id,
      eventType: "statusChanged",
    });
    expect(event.eventData).toEqual({ from: "resolved", to: "open", reason: "userReplied" });
  });

  it("past the window, closes the ticket (for good) and refuses the message, discarding its files", async () => {
    const ticket = await ticketFor({ status: "resolved", resolvedAt: ago(8 * DAY) });

    const res = await api
      .post(`/support/tickets/${ticket.id}/messages`)
      .set(auth(rider.token))
      .attach("attachments", Buffer.from("png"), {
        filename: "late.png",
        contentType: "image/png",
      });
    expectError(
      res,
      409,
      "This ticket is closed. Open a new ticket and link it with relatedTicketId",
    );
    expect((await row(ticket.id)).status).toBe("closed");

    const uploaded = await vi.mocked(uploadAttachment).mock.results.at(-1)!.value;
    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(uploaded.storageKey, uploaded.resourceType);
    expect(
      await db("supportTicketMessages").where({ ticketId: ticket.id, kind: "message" }),
    ).toEqual([]);
  });

  it("keeps notes from the user, never changes status with them, and allows them on closed tickets", async () => {
    const ticket = await ticketFor({
      status: "inProgress",
      assignedAdminId: agent.userId,
      lastMessageAt: ago(DAY),
    });
    const before = await seedMessage(ticket.id, { senderSide: "user", body: "Before" });
    const secret = `Note ${uniqueWord()}`;

    const note = await staffSay("notes", agent, ticket.id, { body: secret });
    expectStatus(note, 201);
    const after = await seedMessage(ticket.id, { senderSide: "user", body: "After" });
    const stored = await row(ticket.id);
    expect(stored.status).toBe("inProgress");
    expect(new Date(stored.lastMessageAt).getTime()).toBeLessThan(Date.now() - DAY / 2);

    const around = await list(rider, ticket.id, `?around=${note.body.data.message.seq}&limit=4`);
    expect(around.body.data.items.map((m: { id: string }) => m.id)).toEqual([before.id, after.id]);
    expect(JSON.stringify(vi.mocked(emitToUser).mock.calls)).not.toContain(secret);
    const staff = await staffList(ticket.id);
    expect(staff.body.data.items.find((m: { body: string }) => m.body === secret)).toMatchObject({
      kind: "note",
      internal: true,
    });

    const closed = await ticketFor({ status: "closed", closedAt: new Date() });
    expectStatus(await staffSay("notes", agent, closed.id), 201);
    expectStatus(await staffSay("messages", agent, closed.id), 409);
  });

  it("only quotes a message the poster can see on the same ticket", async () => {
    const ticket = await ticketFor();
    const other = await ticketFor();
    const note = await seedMessage(ticket.id, { kind: "note" });
    const elsewhere = await seedMessage(other.id);
    const mine = await seedMessage(ticket.id, { senderSide: "user", senderUserId: rider.userId });

    const bad = "You can only reply to a message on this ticket";
    expectError(await say(rider, ticket.id, { body: "x", replyToMessageId: note.id }), 400, bad);
    expectError(
      await say(rider, ticket.id, { body: "x", replyToMessageId: elsewhere.id }),
      400,
      bad,
    );
    expectStatus(
      await staffSay("notes", agent, ticket.id, { body: "x", replyToMessageId: note.id }),
      201,
    );
    const quoted = await say(rider, ticket.id, { body: "As I said", replyToMessageId: mine.id });
    expectStatus(quoted, 201);
    expect(quoted.body.data.message.replyToMessageId).toBe(mine.id);
  });

  it("needs text or a file, and the caller's own ticket", async () => {
    const ticket = await ticketFor();
    expectError(await say(rider, ticket.id, {}), 400, "Write a message or attach a file");
    expectError(await say(stranger, ticket.id), 404, `Support ticket not found: ${ticket.id}`);
    expectStatus(await list(stranger, ticket.id), 404);
    expectStatus(
      await api.post(`/support/tickets/${ticket.id}/read`).set(auth(stranger.token)),
      404,
    );
  });

  it("keeps both of two simultaneous posts, in commit order", async () => {
    const ticket = await ticketFor({ status: "inProgress", assignedAdminId: agent.userId });
    const [mine, theirs] = await Promise.all([
      say(rider, ticket.id),
      staffSay("messages", agent, ticket.id),
    ]);
    expectStatus(mine, 201);
    expectStatus(theirs, 201);
    const messages = await db("supportTicketMessages")
      .where({ ticketId: ticket.id, kind: "message" })
      .orderBy("seq");
    expect(messages).toHaveLength(2);
    const last = messages.at(-1);
    expect((await row(ticket.id)).lastMessageSide).toBe(last.senderSide);
  });
});

describe("paging", () => {
  it("pages 25 messages by seq in every direction, and filters by attachment kind", async () => {
    const ticket = await ticketFor();
    const image = [
      { id: "a", kind: "image", fileUrl: "https://mock-storage.test/a", storageKey: "k" },
    ];
    const seqs: number[] = [];
    for (let i = 0; i < 25; i++) {
      const m = await seedMessage(ticket.id, {
        senderSide: i % 2 ? "staff" : "user",
        ...(i % 10 === 3 && { attachments: image }),
      });
      seqs.push(m.seq);
    }
    const seqsOf = (res: { body: { data: { items: { seq: number }[] } } }) =>
      res.body.data.items.map((m) => m.seq);

    const latest = await list(rider, ticket.id, "?limit=10");
    expect(seqsOf(latest)).toEqual(seqs.slice(15));
    expect(latest.body.data).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false });
    expect(seqsOf(await list(rider, ticket.id, `?limit=10&before=${seqs[15]}`))).toEqual(
      seqs.slice(5, 15),
    );
    const first = await list(rider, ticket.id, `?limit=10&after=${seqs[0] - 1}`);
    expect(seqsOf(first)).toEqual(seqs.slice(0, 10));
    expect(first.body.data).toMatchObject({ hasMoreBefore: false, hasMoreAfter: true });
    expect(seqsOf(await list(rider, ticket.id, `?limit=5&around=${seqs[12]}`))).toEqual(
      seqs.slice(10, 15),
    );

    const gallery = await list(rider, ticket.id, "?attachmentKind=image");
    expect(seqsOf(gallery)).toEqual([seqs[3], seqs[13], seqs[23]]);
    expect(JSON.stringify(gallery.body)).not.toContain("storageKey");

    expectError(
      await list(rider, ticket.id, "?before=5&after=1"),
      400,
      "Use only one of before, after and around",
    );
  });
});

describe("deleting", () => {
  const USER = "/support/tickets";
  const STAFF = "/admin/support/tickets";

  it("lets the sender delete within 15 minutes; the user sees it deleted, staff keep the original", async () => {
    const ticket = await ticketFor();
    const sent = await say(rider, ticket.id, { body: "Oops, my card number" });
    const id = sent.body.data.message.id;

    expectStatus(await remove(USER, rider, ticket.id, id), 200);
    expectError(await remove(USER, rider, ticket.id, id), 409, "This message is already deleted");

    const theirs = (await list(rider, ticket.id)).body.data.items.find(
      (m: { id: string }) => m.id === id,
    );
    expect(theirs).toMatchObject({ deleted: true, removedBy: "user", body: null, attachments: [] });
    const staff = (await staffList(ticket.id)).body.data.items.find(
      (m: { id: string }) => m.id === id,
    );
    expect(staff).toMatchObject({ deleted: true, body: "Oops, my card number" });
  });

  it("refuses an old message, someone else's, and a note to the user", async () => {
    const ticket = await ticketFor();
    const old = await seedMessage(ticket.id, {
      senderSide: "user",
      senderUserId: rider.userId,
      createdAt: ago(20 * 60_000),
    });
    const staffs = await seedMessage(ticket.id, { senderUserId: agent.userId });
    const note = await seedMessage(ticket.id, { kind: "note", senderUserId: agent.userId });

    expectError(
      await remove(USER, rider, ticket.id, old.id),
      409,
      "Messages can only be deleted within 15 minutes of sending",
    );
    expectError(
      await remove(USER, rider, ticket.id, staffs.id),
      403,
      "You can only delete your own messages",
    );
    expectError(
      await remove(USER, rider, ticket.id, note.id),
      404,
      `Message not found: ${note.id}`,
    );
    expectStatus(await remove(STAFF, agent, ticket.id, note.id), 200);
  });

  it("lets support: delete remove anyone's message, any time, on the record", async () => {
    const ticket = await ticketFor();
    const abuse = await seedMessage(ticket.id, {
      senderSide: "user",
      senderUserId: rider.userId,
      createdAt: ago(DAY),
    });

    expectError(
      await remove(STAFF, agent, ticket.id, abuse.id),
      403,
      "You can only delete your own messages",
    );
    expectStatus(await remove(STAFF, moderator, ticket.id, abuse.id), 200);
    const theirs = (await list(rider, ticket.id)).body.data.items.find(
      (m: { id: string }) => m.id === abuse.id,
    );
    expect(theirs).toMatchObject({ deleted: true, removedBy: "support" });

    await flushActivityLogs();
    const [entry] = await db("activityLogs").where({
      action: "support.message.remove",
      targetId: abuse.id,
    });
    expect(entry).toMatchObject({ module: "support", actorId: moderator.userId });
  });
});

describe("reading", () => {
  it("moves each side's marker to the latest message it can see, clearing unread counts", async () => {
    const ticket = await ticketFor();
    await seedMessage(ticket.id, { body: "Any update?" });
    const reply = await seedMessage(ticket.id, { body: "Refund sent" });
    const note = await seedMessage(ticket.id, { kind: "note" });

    expect(
      (await api.get(`/support/tickets/${ticket.id}`).set(auth(rider.token))).body.data.unreadCount,
    ).toBe(2);
    const read = await api.post(`/support/tickets/${ticket.id}/read`).set(auth(rider.token));
    expectStatus(read, 200);
    expect(read.body.data.lastReadSeq).toBe(reply.seq);
    expect(
      (await api.get(`/support/tickets/${ticket.id}`).set(auth(rider.token))).body.data.unreadCount,
    ).toBe(0);
    expect(vi.mocked(emitToUser)).toHaveBeenCalledWith(rider.userId, "support:read", {
      ticketId: ticket.id,
      side: "user",
      lastReadSeq: reply.seq,
    });

    const staffRead = await api
      .post(`/admin/support/tickets/${ticket.id}/read`)
      .set(auth(agent.token));
    expect(staffRead.body.data.lastReadSeq).toBe(note.seq);
    const page = await list(rider, ticket.id);
    expect(page.body.data.readMarkers).toEqual({ user: reply.seq, staff: note.seq });
  });
});
