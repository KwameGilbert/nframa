import { randomInt, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { REQUEST_ID_PREFIX, trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let manager: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: create, read, update, delete
let reader: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read
let outsider: Awaited<ReturnType<typeof createSignedInAdmin>>; // no users access
let rider: Awaited<ReturnType<typeof signUpByPhone>>;
let driver: Awaited<ReturnType<typeof signUpByPhone>>;
let otherRider: Awaited<ReturnType<typeof signUpByPhone>>;

const digits = (count: number) =>
  Array.from({ length: count }, () => randomInt(10)).join("");

const card = (over: object = {}) => ({
  type: "card",
  brand: "Visa",
  lastFourDigits: digits(4),
  expiryMonth: 12,
  expiryYear: 2030,
  ...over,
});

const momo = (over: object = {}) => ({
  type: "mobile_money",
  network: "mtn",
  phoneNumber: `+233${data.ghanaPhoneNumber()}`,
  ...over,
});

const bank = (over: object = {}) => ({
  type: "bank_account",
  bankCode: "GCB",
  bankName: "GCB Bank",
  accountNumber: digits(13),
  accountName: "Kwame Mensah",
  ...over,
});

type Body = ReturnType<typeof card> | ReturnType<typeof momo> | ReturnType<typeof bank>;

async function save(owner: { token: string }, body: Body = momo()) {
  const res = await api.post("/payment-methods").set(auth(owner.token)).send(body);
  expectStatus(res, 201);
  trackForCleanup("paymentMethods", { id: res.body.data.id });
  return res.body.data as { id: string; userId: string; isPrimary: boolean; displayName: string };
}

async function verify(id: string, status = "verified") {
  const res = await api
    .patch(`/admin/payment-methods/${id}`)
    .set(auth(manager.token))
    .send({ verificationStatus: status });
  expectStatus(res, 200);
  return res.body.data;
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [manager, reader, outsider, rider, driver, otherRider] = await Promise.all([
    createSignedInAdmin(superAdmin.token, {
      users: { create: true, read: true, update: true, delete: true },
    }),
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    createSignedInAdmin(superAdmin.token, { commutes: { read: true } }),
    signUpByPhone("rider"),
    signUpByPhone("driver"),
    signUpByPhone("rider"),
  ]);
});

describe("POST /payment-methods", () => {
  it("saves a card from its description and returns it pending, without any internals", async () => {
    const res = await api
      .post("/payment-methods")
      .set(auth(rider.token))
      .send(card({ lastFourDigits: "4242" }));

    expectStatus(res, 201);
    trackForCleanup("paymentMethods", { id: res.body.data.id });
    expect(res.body.data).toMatchObject({
      userId: rider.userId,
      userRole: "rider",
      type: "card",
      displayName: "Visa ending 4242",
      details: { brand: "Visa", lastFourDigits: "4242", expiryMonth: 12, expiryYear: 2030 },
      verificationStatus: "pending",
      verifiedAt: null,
      isPrimary: false,
    });
    for (const internal of ["metadata", "tokenizedReference", "identifier", "provider", "isActive"]) {
      expect(res.body.data).not.toHaveProperty(internal);
    }
  });

  it("masks a mobile money number and a bank account number in the response", async () => {
    const phoneNumber = `+233${data.ghanaPhoneNumber()}`;
    const accountNumber = digits(13);

    const momoRes = await api.post("/payment-methods").set(auth(driver.token)).send(momo({ phoneNumber }));
    const bankRes = await api.post("/payment-methods").set(auth(driver.token)).send(bank({ accountNumber }));

    expectStatus(momoRes, 201);
    expectStatus(bankRes, 201);
    trackForCleanup("paymentMethods", { id: momoRes.body.data.id });
    trackForCleanup("paymentMethods", { id: bankRes.body.data.id });
    expect(momoRes.body.data.details).toEqual({ network: "mtn", phoneNumber: `****${phoneNumber.slice(-4)}` });
    expect(momoRes.body.data.displayName).toBe(`MTN ****${phoneNumber.slice(-4)}`);
    expect(bankRes.body.data.details).toEqual({
      bankCode: "GCB",
      bankName: "GCB Bank",
      accountName: "Kwame Mensah",
      accountNumber: `****${accountNumber.slice(-4)}`,
    });
    expect(JSON.stringify(momoRes.body)).not.toContain(phoneNumber);
    expect(JSON.stringify(bankRes.body)).not.toContain(accountNumber);
  });

  it("uses the label the person gave", async () => {
    const method = await save(rider, momo({ displayName: "My MoMo" }));

    expect(method.displayName).toBe("My MoMo");
  });

  it("refuses a full card number or CVV instead of ignoring them", async () => {
    for (const extra of [{ cardNumber: "4242424242424242" }, { cvv: "123" }]) {
      const res = await api.post("/payment-methods").set(auth(rider.token)).send(card(extra));

      expectStatus(res, 400);
    }
  });

  it("refuses malformed details", async () => {
    const bodies = [
      momo({ phoneNumber: "0541234567" }),
      momo({ network: "orange" }),
      card({ lastFourDigits: "12" }),
      card({ expiryMonth: 13 }),
      bank({ accountNumber: "12AB" }),
      { type: "crypto" },
      {},
    ];

    for (const body of bodies) {
      const res = await api.post("/payment-methods").set(auth(rider.token)).send(body);

      expectStatus(res, 400);
    }
  });

  it("answers 409 for the same one saved twice, but lets someone else save the same number", async () => {
    const body = momo();
    await save(rider, body);

    const again = await api.post("/payment-methods").set(auth(rider.token)).send(body);
    const other = await api.post("/payment-methods").set(auth(otherRider.token)).send(body);

    expectStatus(again, 409);
    expect(again.body.error).toBe("You have already saved this payment method");
    expectStatus(other, 201);
    trackForCleanup("paymentMethods", { id: other.body.data.id });
  });

  it("lets a removed one be saved again", async () => {
    const body = bank();
    const first = await save(rider, body);
    await api.delete(`/payment-methods/${first.id}`).set(auth(rider.token)).expect(200);

    const again = await api.post("/payment-methods").set(auth(rider.token)).send(body);

    expectStatus(again, 201);
    trackForCleanup("paymentMethods", { id: again.body.data.id });
  });

  it("only one of two simultaneous identical requests wins", async () => {
    const body = momo();

    const results = await Promise.all([
      api.post("/payment-methods").set(auth(otherRider.token)).send(body),
      api.post("/payment-methods").set(auth(otherRider.token)).send(body),
    ]);

    const statuses = results.map((res) => res.status).sort();
    for (const res of results) {
      if (res.status === 201) trackForCleanup("paymentMethods", { id: res.body.data.id });
    }
    expect(statuses).toEqual([201, 409]);
  });

  it("is for riders and drivers, and needs a session", async () => {
    const asAdmin = await api.post("/payment-methods").set(auth(manager.token)).send(momo());
    const anonymous = await api.post("/payment-methods").send(momo());

    expectStatus(asAdmin, 403);
    expectStatus(anonymous, 401);
  });

  it("keeps full numbers out of the audit trail", async () => {
    const phoneNumber = `+233${data.ghanaPhoneNumber()}`;
    const method = await save(driver, momo({ phoneNumber }));

    await flushActivityLogs();
    const entries = await db("activityLogs")
      .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
      .where({ action: "paymentMethod.create", targetId: method.id });

    expect(entries).toHaveLength(1);
    expect(entries[0].module).toBe("users");
    expect(entries[0].requestBody.phoneNumber).toBe("[REDACTED]");
    expect(JSON.stringify(entries[0])).not.toContain(phoneNumber);
  });
});

describe("reading my payment methods", () => {
  it("lists only my own, optionally by verification", async () => {
    const pending = await save(otherRider, card());
    const verified = await save(otherRider, bank());
    await verify(verified.id);
    const mine = await save(rider, card());

    const all = await api.get("/payment-methods").set(auth(otherRider.token));
    const onlyVerified = await api.get("/payment-methods?verified=true").set(auth(otherRider.token));
    const onlyPending = await api.get("/payment-methods?verified=false").set(auth(otherRider.token));

    const ids = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((m) => m.id);
    expectStatus(all, 200);
    expect(ids(all)).toEqual(expect.arrayContaining([pending.id, verified.id]));
    expect(ids(all)).not.toContain(mine.id);
    expect(ids(onlyVerified)).toContain(verified.id);
    expect(ids(onlyVerified)).not.toContain(pending.id);
    expect(ids(onlyPending)).toContain(pending.id);
    expect(ids(onlyPending)).not.toContain(verified.id);
    // The primary comes first.
    expect(ids(all)[0]).toBe(verified.id);
  });

  it("reads one of mine, and answers 404 for someone else's", async () => {
    const method = await save(rider, card());

    const own = await api.get(`/payment-methods/${method.id}`).set(auth(rider.token));
    const foreign = await api.get(`/payment-methods/${method.id}`).set(auth(otherRider.token));
    const missing = await api.get(`/payment-methods/${randomUUID()}`).set(auth(rider.token));

    expectStatus(own, 200);
    expect(own.body.data.id).toBe(method.id);
    expectStatus(foreign, 404);
    expectStatus(missing, 404);
  });

  it("refuses a bad filter or id", async () => {
    const badFilter = await api.get("/payment-methods?verified=maybe").set(auth(rider.token));
    const badId = await api.get("/payment-methods/not-a-uuid").set(auth(rider.token));

    expectStatus(badFilter, 400);
    expectStatus(badId, 400);
  });
});

describe("PATCH /payment-methods/:id", () => {
  it("renames", async () => {
    const method = await save(rider, card());

    const res = await api
      .patch(`/payment-methods/${method.id}`)
      .set(auth(rider.token))
      .send({ displayName: "Work card" });

    expectStatus(res, 200);
    expect(res.body.data.displayName).toBe("Work card");
  });

  it("refuses to make an unverified method the primary one", async () => {
    const method = await save(rider, card());

    const res = await api
      .patch(`/payment-methods/${method.id}`)
      .set(auth(rider.token))
      .send({ isPrimary: true });

    expectStatus(res, 409);
    expect(res.body.error).toBe("Only a verified payment method can be your primary one");
  });

  it("moves the primary between verified methods, keeping exactly one", async () => {
    const owner = await signUpByPhone("rider");
    const first = await save(owner, card());
    const second = await save(owner, card());
    await verify(first.id);
    await verify(second.id);

    const res = await api
      .patch(`/payment-methods/${second.id}`)
      .set(auth(owner.token))
      .send({ isPrimary: true });
    const list = await api.get("/payment-methods").set(auth(owner.token));

    expectStatus(res, 200);
    expect(res.body.data.isPrimary).toBe(true);
    const primaries = list.body.data.items.filter((m: { isPrimary: boolean }) => m.isPrimary);
    expect(primaries.map((m: { id: string }) => m.id)).toEqual([second.id]);
  });

  it("can't change the details, or send nothing", async () => {
    const method = await save(rider, momo());

    const details = await api
      .patch(`/payment-methods/${method.id}`)
      .set(auth(rider.token))
      .send({ phoneNumber: "+233541111111" });
    const empty = await api.patch(`/payment-methods/${method.id}`).set(auth(rider.token)).send({});

    expectStatus(details, 400);
    expectStatus(empty, 400);
  });

  it("answers 404 for someone else's", async () => {
    const method = await save(rider, card());

    const res = await api
      .patch(`/payment-methods/${method.id}`)
      .set(auth(otherRider.token))
      .send({ displayName: "Mine now" });

    expectStatus(res, 404);
  });
});

describe("DELETE /payment-methods/:id", () => {
  it("removes it from my list but keeps the record", async () => {
    const method = await save(rider, card());

    const res = await api.delete(`/payment-methods/${method.id}`).set(auth(rider.token));
    const get = await api.get(`/payment-methods/${method.id}`).set(auth(rider.token));
    const list = await api.get("/payment-methods").set(auth(rider.token));

    expectStatus(res, 200);
    expectStatus(get, 404);
    expect(list.body.data.items.map((m: { id: string }) => m.id)).not.toContain(method.id);
    const row = await db("paymentMethods").where({ id: method.id }).first();
    expect(row).toMatchObject({ isActive: false, isPrimary: false });
  });

  it("answers 404 for someone else's, and for one already removed", async () => {
    const method = await save(rider, card());

    const foreign = await api.delete(`/payment-methods/${method.id}`).set(auth(otherRider.token));
    await api.delete(`/payment-methods/${method.id}`).set(auth(rider.token)).expect(200);
    const again = await api.delete(`/payment-methods/${method.id}`).set(auth(rider.token));

    expectStatus(foreign, 404);
    expectStatus(again, 404);
  });
});

describe("staff payment method routes", () => {
  it("lists everyone's with masked numbers, filtered, for users: read", async () => {
    const phoneNumber = `+233${data.ghanaPhoneNumber()}`;
    const method = await save(driver, momo({ phoneNumber }));

    const res = await api
      .get(`/admin/payment-methods?userId=${driver.userId}&userRole=driver&verificationStatus=pending`)
      .set(auth(reader.token));

    expectStatus(res, 200);
    expect(res.body.data.items.map((m: { id: string }) => m.id)).toContain(method.id);
    expect(
      res.body.data.items.every((m: { userId: string; userRole: string }) => m.userId === driver.userId && m.userRole === "driver"),
    ).toBe(true);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 20 });
    expect(JSON.stringify(res.body)).not.toContain(phoneNumber);
  });

  it("is closed to admins without users access and to riders", async () => {
    const asOutsider = await api.get("/admin/payment-methods").set(auth(outsider.token));
    const asRider = await api.get("/admin/payment-methods").set(auth(rider.token));

    expectStatus(asOutsider, 403);
    expectStatus(asRider, 403);
  });

  it("verifies, making it the primary if there is none, and unverifying clears that", async () => {
    const owner = await signUpByPhone("driver");
    const method = await save(owner, momo());

    const verified = await verify(method.id);
    const reset = await verify(method.id, "pending");

    expect(verified).toMatchObject({ verificationStatus: "verified", isPrimary: true });
    expect(verified.verifiedAt).not.toBeNull();
    expect(reset).toMatchObject({ verificationStatus: "pending", isPrimary: false, verifiedAt: null });
  });

  it("only makes the first verified method primary", async () => {
    const owner = await signUpByPhone("driver");
    const first = await save(owner, momo());
    const second = await save(owner, bank());

    const a = await verify(first.id);
    const b = await verify(second.id);

    expect(a.isPrimary).toBe(true);
    expect(b.isPrimary).toBe(false);
  });

  it("needs users: update to verify and users: delete to remove", async () => {
    const method = await save(rider, card());

    const verifyDenied = await api
      .patch(`/admin/payment-methods/${method.id}`)
      .set(auth(reader.token))
      .send({ verificationStatus: "verified" });
    const deleteDenied = await api.delete(`/admin/payment-methods/${method.id}`).set(auth(reader.token));
    const removed = await api.delete(`/admin/payment-methods/${method.id}`).set(auth(manager.token));
    const gone = await api.delete(`/admin/payment-methods/${method.id}`).set(auth(manager.token));

    expectStatus(verifyDenied, 403);
    expectStatus(deleteDenied, 403);
    expectStatus(removed, 200);
    expectStatus(gone, 404);
  });

  it("refuses an unknown status or extra fields, and 404s an unknown method", async () => {
    const method = await save(rider, card());

    const status = await api
      .patch(`/admin/payment-methods/${method.id}`)
      .set(auth(manager.token))
      .send({ verificationStatus: "approved" });
    const extra = await api
      .patch(`/admin/payment-methods/${method.id}`)
      .set(auth(manager.token))
      .send({ verificationStatus: "verified", isPrimary: true });
    const missing = await api
      .patch(`/admin/payment-methods/${randomUUID()}`)
      .set(auth(manager.token))
      .send({ verificationStatus: "verified" });

    expectStatus(status, 400);
    expectStatus(extra, 400);
    expectStatus(missing, 404);
  });

  it("records who verified it, before and after", async () => {
    const method = await save(rider, card());
    await verify(method.id);

    await flushActivityLogs();
    const [entry] = await db("activityLogs")
      .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
      .where({ action: "paymentMethod.setVerification", targetId: method.id });

    expect(entry.before.verificationStatus).toBe("pending");
    expect(entry.after.verificationStatus).toBe("verified");
    expect(entry.changedFields).toContain("verificationStatus");
  });
});
