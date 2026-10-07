import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { emitToSupportDesk, emitToUser } from "../src/services/socket.service.js";
import { registerSupportSocket, type Ack } from "../src/services/supportSocket.service.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { seedCategory, seedTicket, uniqueWord } from "./helpers/support.js";

type Session = { userId: string; fullName?: string };
type Reply = Parameters<Ack>[0];

let agent: Session; // support: read, update
let reader: Session; // support: read
let rider: Session;
let stranger: Session;
let categoryId: string;

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  let category;
  [agent, reader, rider, stranger, category] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { support: { read: true } }),
    signUpByPhone("rider"),
    signUpByPhone("rider"),
    seedCategory(),
  ]);
  categoryId = category.id;
});

// A stand-in for a connected socket: records the handlers registerSupportSocket attaches.
function connect(who: Session, userType: "user" | "admin") {
  const handlers: Record<string, (payload: unknown, ack?: Ack) => void> = {};
  registerSupportSocket({
    id: randomUUID(),
    data: { userId: who.userId, userType, role: userType === "admin" ? "admin" : "rider" },
    on: (event: string, handler: (payload: unknown, ack?: Ack) => void) =>
      (handlers[event] = handler),
  } as never);
  const call = (event: string, payload: unknown) =>
    new Promise<Reply>((resolve) => handlers[event](payload, resolve));
  // Typing has no ack: wait for the handler's work to finish.
  const typing = async (payload: unknown) => {
    handlers["support:typing"](payload);
    await new Promise((r) => setTimeout(r, 150));
  };
  return { call, typing };
}

const typingCalls = (ticketId: string) => [
  ...vi
    .mocked(emitToSupportDesk)
    .mock.calls.filter(
      ([e, p]) => e === "support:typing" && (p as { ticketId: string }).ticketId === ticketId,
    ),
  ...vi
    .mocked(emitToUser)
    .mock.calls.filter(
      ([, e, p]) => e === "support:typing" && (p as { ticketId: string }).ticketId === ticketId,
    ),
];

describe("support:send", () => {
  it("posts the user's message and acks with their view", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    const body = `Socket ${uniqueWord()}`;

    const reply = await connect(rider, "user").call("support:send", { ticketId: ticket.id, body });
    expect(reply).toMatchObject({
      ok: true,
      data: { message: { body, from: "user" }, ticket: { id: ticket.id } },
    });
    expect(
      await db("supportTicketMessages").where({ ticketId: ticket.id, body }).first(),
    ).toBeDefined();
    expect(vi.mocked(emitToSupportDesk)).toHaveBeenCalledWith(
      "support:message",
      expect.objectContaining({ ticketId: ticket.id }),
    );
  });

  it("lets staff add a note that never reaches the user", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    const body = `Note ${uniqueWord()}`;

    const reply = await connect(agent, "admin").call("support:send", {
      ticketId: ticket.id,
      body,
      internal: true,
    });
    expect(reply).toMatchObject({ ok: true, data: { message: { kind: "note", internal: true } } });
    expect(JSON.stringify(vi.mocked(emitToUser).mock.calls)).not.toContain(body);
  });

  it("acks errors instead of throwing: bad payload, not theirs, no permission, closed", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    const closed = await seedTicket(rider.userId, categoryId, {
      status: "closed",
      closedAt: new Date(),
    });

    expect(
      await connect(rider, "user").call("support:send", { ticketId: ticket.id }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await connect(stranger, "user").call("support:send", { ticketId: ticket.id, body: "x" }),
    ).toEqual({
      ok: false,
      status: 404,
      error: `Support ticket not found: ${ticket.id}`,
    });
    expect(
      await connect(reader, "admin").call("support:send", { ticketId: ticket.id, body: "x" }),
    ).toEqual({
      ok: false,
      status: 403,
      error: "Missing permission: update on support",
    });
    expect(
      await connect(rider, "user").call("support:send", { ticketId: closed.id, body: "x" }),
    ).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("limits each account to 120 sends per 15 minutes", async () => {
    const flooder = await signUpByPhone("rider");
    const socket = connect(flooder, "user");
    for (let i = 0; i < 120; i++) await socket.call("support:send", {});
    expect(await socket.call("support:send", {})).toEqual({
      ok: false,
      status: 429,
      error: "Too many requests, try again later",
    });
  });
});

describe("support:read", () => {
  it("moves the caller's marker and tells the other side", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    await connect(agent, "admin").call("support:send", { ticketId: ticket.id, body: "Hello" });

    const reply = await connect(rider, "user").call("support:read", { ticketId: ticket.id });
    expect(reply).toMatchObject({ ok: true, data: { lastReadSeq: expect.any(Number) } });
    expect(vi.mocked(emitToSupportDesk)).toHaveBeenCalledWith("support:read", {
      ticketId: ticket.id,
      side: "user",
      lastReadSeq: (reply as { data: { lastReadSeq: number } }).data.lastReadSeq,
    });
  });
});

describe("support:typing", () => {
  it("relays the user to the desk, throttled, and 'stopped' only after 'typing'", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    const socket = connect(rider, "user");

    await socket.typing({ ticketId: ticket.id, isTyping: false });
    await socket.typing({ ticketId: ticket.id, isTyping: true });
    await socket.typing({ ticketId: ticket.id, isTyping: true });
    await socket.typing({ ticketId: ticket.id, isTyping: false });
    await socket.typing({ ticketId: ticket.id, isTyping: "yes" });

    expect(typingCalls(ticket.id)).toEqual([
      ["support:typing", { ticketId: ticket.id, side: "user", isTyping: true }],
      ["support:typing", { ticketId: ticket.id, side: "user", isTyping: false }],
    ]);
  });

  it("drops typing on someone else's or a closed ticket", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    const closed = await seedTicket(rider.userId, categoryId, {
      status: "closed",
      closedAt: new Date(),
    });
    await connect(stranger, "user").typing({ ticketId: ticket.id, isTyping: true });
    await connect(rider, "user").typing({ ticketId: closed.id, isTyping: true });
    expect([...typingCalls(ticket.id), ...typingCalls(closed.id)]).toEqual([]);
  });

  it("shows staff typing to the user by first name, unless it's an internal note", async () => {
    const ticket = await seedTicket(rider.userId, categoryId);
    const internal = await seedTicket(rider.userId, categoryId);
    await connect(agent, "admin").typing({ ticketId: ticket.id, isTyping: true });
    await connect(agent, "admin").typing({ ticketId: internal.id, isTyping: true, internal: true });
    await connect(reader, "admin").typing({ ticketId: ticket.id, isTyping: false });

    expect(vi.mocked(emitToUser)).toHaveBeenCalledWith(rider.userId, "support:typing", {
      ticketId: ticket.id,
      side: "staff",
      name: agent.fullName!.split(" ")[0],
      isTyping: true,
    });
    expect(typingCalls(internal.id)).toEqual([
      [
        "support:typing",
        expect.objectContaining({ side: "staff", userId: agent.userId, internal: true }),
      ],
    ]);
  });
});
