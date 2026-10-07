import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { trackForCleanup } from "./helpers/cleanup.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let manager: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: create, read, update, delete
let outsider: Awaited<ReturnType<typeof createSignedInAdmin>>; // an admin with no users access
let rider: Awaited<ReturnType<typeof signUpByPhone>>;
let driver: Awaited<ReturnType<typeof signUpByPhone>>;

function contact() {
  return {
    name: data.person().fullName,
    phoneCountryCode: data.GHANA_COUNTRY_CODE,
    phoneNumber: data.ghanaPhoneNumber(),
    relationship: "Sister",
  };
}

async function addContact(owner: { token: string }, body: object = contact()) {
  const res = await api.post("/emergency-contacts").set(auth(owner.token)).send(body);
  expectStatus(res, 201);
  trackForCleanup("emergencyContacts", { id: res.body.data.id });
  return res.body.data as { id: string; userId: string };
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [manager, outsider, rider, driver] = await Promise.all([
    createSignedInAdmin(superAdmin.token, {
      users: { create: true, read: true, update: true, delete: true },
    }),
    createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
    signUpByPhone("rider"),
    signUpByPhone("driver"),
  ]);
});

describe("POST /emergency-contacts", () => {
  it("lets a rider add their own contact", async () => {
    const body = contact();

    const res = await api.post("/emergency-contacts").set(auth(rider.token)).send(body);

    expectStatus(res, 201);
    trackForCleanup("emergencyContacts", { id: res.body.data.id });
    expect(res.body.message).toBe("Emergency contact created successfully");
    expect(res.body.data).toMatchObject({ ...body, userId: rider.userId });
  });

  it("lets a driver add their own contact", async () => {
    const created = await addContact(driver);

    expect(created.userId).toBe(driver.userId);
  });

  it("lets an admin with users: create add one for a rider", async () => {
    const created = await addContact(manager, { ...contact(), userId: rider.userId });

    expect(created.userId).toBe(rider.userId);
  });

  it("doesn't let a rider add a contact for someone else", async () => {
    const res = await api
      .post("/emergency-contacts")
      .set(auth(rider.token))
      .send({ ...contact(), userId: driver.userId });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on users");
  });

  it("doesn't let an admin without users: create add one", async () => {
    const res = await api
      .post("/emergency-contacts")
      .set(auth(outsider.token))
      .send({ ...contact(), userId: rider.userId });

    expectStatus(res, 403);
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.post("/emergency-contacts").send(contact()), 401);
  });

  it.each([
    ["a missing name", { name: undefined }],
    ["a blank name", { name: "  " }],
    ["a missing relationship", { relationship: undefined }],
    ["a missing country code", { phoneCountryCode: undefined }],
    ["a too-short phone number", { phoneNumber: "123" }],
  ])("rejects %s", async (_name, override) => {
    const res = await api
      .post("/emergency-contacts")
      .set(auth(rider.token))
      .send({ ...contact(), ...override });

    expectStatus(res, 400);
  });
});

describe("GET /emergency-contacts", () => {
  it("lists only the caller's contacts", async () => {
    const mine = await addContact(rider);
    await addContact(driver);

    const res = await api.get("/emergency-contacts").set(auth(rider.token));

    expectStatus(res, 200);
    const rows = res.body.data as { id: string; userId: string }[];
    expect(rows.map((row) => row.id)).toContain(mine.id);
    expect(rows.every((row) => row.userId === rider.userId)).toBe(true);
  });

  it("lets an admin with users: read list another user's contacts", async () => {
    const created = await addContact(driver);

    const res = await api
      .get("/emergency-contacts")
      .query({ userId: driver.userId })
      .set(auth(manager.token));

    expectStatus(res, 200);
    expect((res.body.data as { id: string }[]).map((row) => row.id)).toContain(created.id);
  });

  it("doesn't let a rider list another user's contacts", async () => {
    const res = await api
      .get("/emergency-contacts")
      .query({ userId: driver.userId })
      .set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });
});

describe("GET /emergency-contacts/:id", () => {
  it("returns the contact to its owner and to an admin with users: read", async () => {
    const created = await addContact(rider);

    const own = await api.get(`/emergency-contacts/${created.id}`).set(auth(rider.token));
    const admin = await api.get(`/emergency-contacts/${created.id}`).set(auth(manager.token));

    expectStatus(own, 200);
    expectStatus(admin, 200);
    expect(own.body.data.id).toBe(created.id);
  });

  it("doesn't show it to another user or an admin without users: read", async () => {
    const created = await addContact(rider);

    expectStatus(await api.get(`/emergency-contacts/${created.id}`).set(auth(driver.token)), 403);
    expectStatus(await api.get(`/emergency-contacts/${created.id}`).set(auth(outsider.token)), 403);
  });

  it("404s for an unknown id and 400s for a malformed one", async () => {
    const id = randomUUID();

    const missing = await api.get(`/emergency-contacts/${id}`).set(auth(rider.token));
    const malformed = await api.get("/emergency-contacts/nope").set(auth(rider.token));

    expectStatus(missing, 404);
    expect(missing.body.error).toBe(`Emergency contact not found: ${id}`);
    expectStatus(malformed, 400);
  });
});

describe("PATCH /emergency-contacts/:id", () => {
  it("lets the owner update fields", async () => {
    const created = await addContact(rider);

    const res = await api
      .patch(`/emergency-contacts/${created.id}`)
      .set(auth(rider.token))
      .send({ name: "Kofi Boateng", relationship: "Brother" });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ name: "Kofi Boateng", relationship: "Brother" });
  });

  it("lets an admin with users: update change it", async () => {
    const created = await addContact(rider);

    const res = await api
      .patch(`/emergency-contacts/${created.id}`)
      .set(auth(manager.token))
      .send({ phoneNumber: data.ghanaPhoneNumber() });

    expectStatus(res, 200);
  });

  it("doesn't let another user update it", async () => {
    const created = await addContact(rider);

    const res = await api
      .patch(`/emergency-contacts/${created.id}`)
      .set(auth(driver.token))
      .send({ name: "Someone Else" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on users");
  });

  it("rejects an empty body", async () => {
    const created = await addContact(rider);

    const res = await api
      .patch(`/emergency-contacts/${created.id}`)
      .set(auth(rider.token))
      .send({});

    expectStatus(res, 400);
  });
});

describe("DELETE /emergency-contacts/:id", () => {
  it("lets the owner delete it", async () => {
    const created = await addContact(rider);

    const res = await api.delete(`/emergency-contacts/${created.id}`).set(auth(rider.token));

    expectStatus(res, 200);
    expectStatus(await api.get(`/emergency-contacts/${created.id}`).set(auth(rider.token)), 404);
  });

  it("lets an admin with users: delete remove it", async () => {
    const created = await addContact(rider);

    expectStatus(
      await api.delete(`/emergency-contacts/${created.id}`).set(auth(manager.token)),
      200,
    );
  });

  it("doesn't let another user delete it", async () => {
    const created = await addContact(rider);

    const res = await api.delete(`/emergency-contacts/${created.id}`).set(auth(driver.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on users");
  });
});
