import { beforeAll, describe, expect, it } from "vitest";
import { flushNotifications } from "../src/services/notification.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { expoPushesTo, forceExpo, inboxOf, seedDevice } from "./helpers/push.js";
import { seedCategory, seedTicket, uniqueWord } from "./helpers/support.js";

type Session = { userId: string; token: string; fullName?: string };
type Device = Awaited<ReturnType<typeof seedDevice>>;

let agent: Session; // support: create, read, update
let agent2: Session; // support: read, update
let outsider: Session; // no support access
let rider: Session;
let devices: Record<"agent" | "agent2" | "outsider" | "rider", Device>;
let normal: { id: string };
let urgent: { id: string };

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  [agent, agent2, outsider, rider, normal, urgent] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { support: { create: true, read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true } }),
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    signUpByPhone("rider"),
    seedCategory(),
    seedCategory({ defaultPriority: "urgent" }),
  ]);
  const [a, b, c, d] = await Promise.all(
    [agent, agent2, outsider, rider].map((who) => seedDevice(who.userId, "ios")),
  );
  devices = { agent: a, agent2: b, outsider: c, rider: d };
});

// The pushes a device got about one ticket, after every pending delivery has finished.
async function pushes(device: Device, ticketId: string) {
  await flushNotifications();
  return expoPushesTo(device.token).filter((m) => (m.data as { ticketId?: string })?.ticketId === ticketId);
}
const types = (messages: Awaited<ReturnType<typeof pushes>>) => messages.map((m) => (m.data as { type: string }).type);

const staffReply = (who: Session, id: string) =>
  api.post(`/admin/support/tickets/${id}/messages`).set(auth(who.token)).send({ body: `Re ${uniqueWord()}` });
const userReply = (id: string) =>
  api.post(`/support/tickets/${id}/messages`).set(auth(rider.token)).send({ body: `Hi ${uniqueWord()}` });

describe("chat pushes", () => {
  it("pushes a support reply once per unread run, and keeps it out of the inbox", async () => {
    const ticket = await seedTicket(rider.userId, normal.id);

    expectStatus(await staffReply(agent, ticket.id), 201);
    expectStatus(await staffReply(agent, ticket.id), 201);
    expect(types(await pushes(devices.rider, ticket.id))).toEqual(["support.reply"]);

    expectStatus(await api.post(`/support/tickets/${ticket.id}/read`).set(auth(rider.token)), 200);
    expectStatus(await staffReply(agent, ticket.id), 201);
    const all = await pushes(devices.rider, ticket.id);
    expect(types(all)).toEqual(["support.reply", "support.reply"]);
    expect(all[0]).toMatchObject({ title: "Nframa Support replied", data: { ticketId: ticket.id } });
    expect((await inboxOf(rider.userId)).filter((n) => n.type === "support.reply")).toEqual([]);
  });

  it("pushes the assignee when the user replies, once per unread run", async () => {
    const ticket = await seedTicket(rider.userId, normal.id, { status: "inProgress", assignedAdminId: agent2.userId });

    expectStatus(await userReply(ticket.id), 201);
    expectStatus(await userReply(ticket.id), 201);
    expect(types(await pushes(devices.agent2, ticket.id))).toEqual(["support.userReplied"]);
  });

  it("still answers 201 when the push provider fails", async () => {
    const ticket = await seedTicket(rider.userId, normal.id);
    forceExpo(devices.rider.token, "throw");
    try {
      expectStatus(await staffReply(agent, ticket.id), 201);
      await flushNotifications();
    } finally {
      forceExpo(devices.rider.token, "ok");
    }
  });
});

describe("ticket pushes", () => {
  it("tells the user, in the inbox too, when staff resolve their ticket, but not for other changes", async () => {
    const ticket = await seedTicket(rider.userId, normal.id, { status: "inProgress" });
    const patch = (body: object) =>
      api.patch(`/admin/support/tickets/${ticket.id}`).set(auth(agent.token)).send(body);

    expectStatus(await patch({ priority: "high" }), 200);
    expectStatus(await patch({ status: "resolved" }), 200);
    expect(types(await pushes(devices.rider, ticket.id))).toEqual(["support.statusChanged"]);
    const [row] = (await inboxOf(rider.userId)).filter((n) => n.data.ticketId === ticket.id);
    expect(row).toMatchObject({ type: "support.statusChanged", title: "Your support ticket was resolved" });
  });

  it("tells an agent when someone else assigns them, never when they take it themselves", async () => {
    const mine = await seedTicket(rider.userId, normal.id);
    const given = await seedTicket(rider.userId, normal.id);

    expectStatus(await api.post(`/admin/support/tickets/${mine.id}/assign`).set(auth(agent.token)), 200);
    expectStatus(
      await api.post(`/admin/support/tickets/${given.id}/assign`).set(auth(agent.token)).send({ adminId: agent2.userId }),
      200,
    );
    expect(await pushes(devices.agent, mine.id)).toEqual([]);
    expect(types(await pushes(devices.agent2, given.id))).toEqual(["support.assigned"]);
  });

  it("tells the user, in the inbox too, when staff open a ticket for them", async () => {
    const res = await api.post("/admin/support/tickets").set(auth(agent.token)).send({
      userId: rider.userId,
      categoryId: normal.id,
      subject: "About your call",
      message: "We're on it.",
    });
    expectStatus(res, 201);
    trackForCleanup("supportTickets", { id: res.body.data.id });

    expect(types(await pushes(devices.rider, res.body.data.id))).toEqual(["support.openedForYou"]);
    expect((await inboxOf(rider.userId)).some((n) => n.data.ticketId === res.body.data.id)).toBe(true);
  });

  it("alerts the support desk for urgent tickets only, and only staff who can read support", async () => {
    const open = async (categoryId: string) => {
      const res = await api
        .post("/support/tickets")
        .set(auth(rider.token))
        .send({ categoryId, subject: `Secret ${uniqueWord()}`, message: `Private ${uniqueWord()}` });
      expectStatus(res, 201);
      trackForCleanup("supportTickets", { id: res.body.data.id });
      return res.body.data as { id: string; code: string; subject: string };
    };
    const hot = await open(urgent.id);
    const calm = await open(normal.id);

    const alerts = await pushes(devices.agent, hot.id);
    expect(alerts).toEqual([
      expect.objectContaining({ title: "New urgent support ticket", data: { ticketId: hot.id, type: "support.deskAlert" } }),
    ]);
    expect(await pushes(devices.outsider, hot.id)).toEqual([]);
    expect(await pushes(devices.agent, calm.id)).toEqual([]);
    // Pushes cross Expo, APNs and FCM in plaintext: never the subject, a message, the code or a name.
    expect(JSON.stringify(alerts)).not.toMatch(new RegExp(`${hot.subject}|${hot.code}|Private`));
  });
});
