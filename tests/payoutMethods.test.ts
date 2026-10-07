import { randomInt, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { REQUEST_ID_PREFIX, trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let verifier: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: update
let payoutsAdmin: Awaited<ReturnType<typeof createSignedInAdmin>>; // payouts: read, update
let payoutsReader: Awaited<ReturnType<typeof createSignedInAdmin>>; // payouts: read
let usersOnly: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: everything, no payouts
let driver: Awaited<ReturnType<typeof signUpByPhone>>;
let otherDriver: Awaited<ReturnType<typeof signUpByPhone>>;
let rider: Awaited<ReturnType<typeof signUpByPhone>>;

const digits = (count: number) => Array.from({ length: count }, () => randomInt(10)).join("");

const momoBody = () => ({
  type: "mobile_money",
  network: "mtn",
  phoneNumber: `+233${data.ghanaPhoneNumber()}`,
});

const bankBody = () => ({
  type: "bank_account",
  bankCode: "GCB",
  bankName: "GCB Bank",
  accountNumber: digits(13),
  accountName: "Kwame Mensah",
});

const cardBody = () => ({
  type: "card",
  brand: "Visa",
  lastFourDigits: digits(4),
  expiryMonth: 12,
  expiryYear: 2030,
});

// A payment method the owner has saved, optionally already verified by staff.
async function paymentMethod(owner: { token: string }, body: object = momoBody(), verified = true) {
  const res = await api.post("/payment-methods").set(auth(owner.token)).send(body);
  expectStatus(res, 201);
  const id = res.body.data.id as string;
  trackForCleanup("paymentMethods", { id });
  if (verified) {
    await api
      .patch(`/admin/payment-methods/${id}`)
      .set(auth(verifier.token))
      .send({ verificationStatus: "verified" })
      .expect(200);
  }
  return id;
}

async function addPayoutMethod(
  owner: { token: string },
  paymentMethodId: string,
  extra: object = {},
) {
  const res = await api
    .post("/payout-methods")
    .set(auth(owner.token))
    .send({ paymentMethodId, ...extra });
  expectStatus(res, 201);
  trackForCleanup("payoutMethods", { id: res.body.data.id });
  return res.body.data as { id: string; isPrimary: boolean; driverUserId: string };
}

// A driver of their own, so a test can count on the primary being theirs alone.
async function freshDriver() {
  return signUpByPhone("driver");
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [verifier, payoutsAdmin, payoutsReader, usersOnly, driver, otherDriver, rider] =
    await Promise.all([
      createSignedInAdmin(superAdmin.token, { users: { update: true } }),
      createSignedInAdmin(superAdmin.token, { payouts: { read: true, update: true } }),
      createSignedInAdmin(superAdmin.token, { payouts: { read: true } }),
      createSignedInAdmin(superAdmin.token, {
        users: { create: true, read: true, update: true, delete: true },
      }),
      signUpByPhone("driver"),
      signUpByPhone("driver"),
      signUpByPhone("rider"),
    ]);
});

describe("POST /payout-methods", () => {
  it("adds a verified mobile money number with defaults, as the first and so primary one", async () => {
    const owner = await freshDriver();
    const id = await paymentMethod(owner);

    const res = await api
      .post("/payout-methods")
      .set(auth(owner.token))
      .send({ paymentMethodId: id });

    expectStatus(res, 201);
    trackForCleanup("payoutMethods", { id: res.body.data.id });
    expect(res.body.data).toMatchObject({
      driverUserId: owner.userId,
      paymentMethodId: id,
      isAutomatic: false,
      minimumThreshold: 0,
      payoutFrequency: "daily",
      isPrimary: true,
      paymentMethod: { type: "mobile_money", verificationStatus: "verified" },
    });
    expect(res.body.data.paymentMethod.displayName).toMatch(/^MTN \*\*\*\*\d{4}$/);
  });

  it("takes automatic payout settings, and a bank account works too", async () => {
    const id = await paymentMethod(driver, bankBody());

    const method = await api.post("/payout-methods").set(auth(driver.token)).send({
      paymentMethodId: id,
      isAutomatic: true,
      minimumThreshold: 150.5,
      payoutFrequency: "weekly",
    });

    expectStatus(method, 201);
    trackForCleanup("payoutMethods", { id: method.body.data.id });
    expect(method.body.data).toMatchObject({
      isAutomatic: true,
      minimumThreshold: 150.5,
      payoutFrequency: "weekly",
      paymentMethod: { type: "bank_account" },
    });
  });

  it("only the first is primary", async () => {
    const owner = await freshDriver();
    const first = await addPayoutMethod(owner, await paymentMethod(owner));
    const second = await addPayoutMethod(owner, await paymentMethod(owner, bankBody()));

    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
  });

  it("refuses a payment method that isn't verified yet", async () => {
    const id = await paymentMethod(driver, momoBody(), false);

    const res = await api
      .post("/payout-methods")
      .set(auth(driver.token))
      .send({ paymentMethodId: id });

    expectStatus(res, 409);
    expect(res.body.error).toBe("Verify this payment method before using it for payouts");
  });

  it("refuses a card", async () => {
    const id = await paymentMethod(driver, cardBody());

    const res = await api
      .post("/payout-methods")
      .set(auth(driver.token))
      .send({ paymentMethodId: id });

    expectStatus(res, 400);
  });

  it("refuses someone else's payment method, a missing one and a removed one with 404", async () => {
    const foreign = await paymentMethod(otherDriver);
    const removed = await paymentMethod(driver);
    await api.delete(`/payment-methods/${removed}`).set(auth(driver.token)).expect(200);

    for (const id of [foreign, removed, randomUUID()]) {
      const res = await api
        .post("/payout-methods")
        .set(auth(driver.token))
        .send({ paymentMethodId: id });

      expectStatus(res, 404);
    }
  });

  it("answers 409 when the payment method is already a payout method", async () => {
    const id = await paymentMethod(driver);
    await addPayoutMethod(driver, id);

    const again = await api
      .post("/payout-methods")
      .set(auth(driver.token))
      .send({ paymentMethodId: id });

    expectStatus(again, 409);
  });

  it("is for drivers", async () => {
    const id = await paymentMethod(rider);

    const res = await api
      .post("/payout-methods")
      .set(auth(rider.token))
      .send({ paymentMethodId: id });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Only drivers can set up payouts");
  });

  it("refuses bad settings and unknown fields", async () => {
    const id = await paymentMethod(driver);
    const bodies = [
      {},
      { paymentMethodId: "nope" },
      { paymentMethodId: id, minimumThreshold: -5 },
      { paymentMethodId: id, payoutFrequency: "hourly" },
      { paymentMethodId: id, isPrimary: true },
    ];

    for (const body of bodies) {
      const res = await api.post("/payout-methods").set(auth(driver.token)).send(body);

      expectStatus(res, 400);
    }
  });
});

describe("GET /payout-methods", () => {
  it("lists only mine, primary first", async () => {
    const owner = await freshDriver();
    const first = await addPayoutMethod(owner, await paymentMethod(owner));
    const second = await addPayoutMethod(owner, await paymentMethod(owner, bankBody()));
    await addPayoutMethod(otherDriver, await paymentMethod(otherDriver));

    const res = await api.get("/payout-methods").set(auth(owner.token));

    expectStatus(res, 200);
    expect(res.body.data.items.map((m: { id: string }) => m.id)).toEqual([first.id, second.id]);
  });

  it("is empty for someone with none", async () => {
    const res = await api.get("/payout-methods").set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data.items).toEqual([]);
  });
});

describe("PATCH /payout-methods/:id", () => {
  it("changes the settings", async () => {
    const method = await addPayoutMethod(driver, await paymentMethod(driver));

    const res = await api
      .patch(`/payout-methods/${method.id}`)
      .set(auth(driver.token))
      .send({ isAutomatic: true, minimumThreshold: 75, payoutFrequency: "monthly" });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      isAutomatic: true,
      minimumThreshold: 75,
      payoutFrequency: "monthly",
    });
  });

  it("moves the primary, keeping exactly one", async () => {
    const owner = await freshDriver();
    const first = await addPayoutMethod(owner, await paymentMethod(owner));
    const second = await addPayoutMethod(owner, await paymentMethod(owner, bankBody()));

    const res = await api
      .patch(`/payout-methods/${second.id}`)
      .set(auth(owner.token))
      .send({ isPrimary: true });
    const list = await api.get("/payout-methods").set(auth(owner.token));

    expectStatus(res, 200);
    expect(res.body.data.isPrimary).toBe(true);
    const primaries = list.body.data.items.filter((m: { isPrimary: boolean }) => m.isPrimary);
    expect(primaries.map((m: { id: string }) => m.id)).toEqual([second.id]);
    expect(list.body.data.items.map((m: { id: string }) => m.id)).toContain(first.id);
  });

  it("won't make a payout method primary once its payment method lost verification", async () => {
    const owner = await freshDriver();
    const firstPayment = await paymentMethod(owner);
    await addPayoutMethod(owner, firstPayment);
    const secondPayment = await paymentMethod(owner, bankBody());
    const second = await addPayoutMethod(owner, secondPayment);
    await api
      .patch(`/admin/payment-methods/${secondPayment}`)
      .set(auth(verifier.token))
      .send({ verificationStatus: "failed" })
      .expect(200);

    const res = await api
      .patch(`/payout-methods/${second.id}`)
      .set(auth(owner.token))
      .send({ isPrimary: true });

    expectStatus(res, 409);
  });

  it("answers 404 for someone else's, and refuses an empty or unknown body", async () => {
    const method = await addPayoutMethod(driver, await paymentMethod(driver));

    const foreign = await api
      .patch(`/payout-methods/${method.id}`)
      .set(auth(otherDriver.token))
      .send({ isAutomatic: true });
    const empty = await api.patch(`/payout-methods/${method.id}`).set(auth(driver.token)).send({});
    const unknown = await api
      .patch(`/payout-methods/${method.id}`)
      .set(auth(driver.token))
      .send({ paymentMethodId: randomUUID() });

    expectStatus(foreign, 404);
    expectStatus(empty, 400);
    expectStatus(unknown, 400);
  });
});

describe("removing", () => {
  it("DELETE removes the payout method but keeps the payment method, and the next one becomes primary", async () => {
    const owner = await freshDriver();
    const firstPayment = await paymentMethod(owner);
    const first = await addPayoutMethod(owner, firstPayment);
    const second = await addPayoutMethod(owner, await paymentMethod(owner, bankBody()));

    const res = await api.delete(`/payout-methods/${first.id}`).set(auth(owner.token));
    const list = await api.get("/payout-methods").set(auth(owner.token));
    const payment = await api.get(`/payment-methods/${firstPayment}`).set(auth(owner.token));

    expectStatus(res, 200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ id: second.id, isPrimary: true });
    expectStatus(payment, 200);
  });

  it("DELETE answers 404 for someone else's", async () => {
    const method = await addPayoutMethod(driver, await paymentMethod(driver));

    const res = await api.delete(`/payout-methods/${method.id}`).set(auth(otherDriver.token));

    expectStatus(res, 404);
  });

  it("removing the payment method removes its payout method too", async () => {
    const owner = await freshDriver();
    const payment = await paymentMethod(owner);
    await addPayoutMethod(owner, payment);
    const other = await addPayoutMethod(owner, await paymentMethod(owner, bankBody()));

    await api.delete(`/payment-methods/${payment}`).set(auth(owner.token)).expect(200);
    const list = await api.get("/payout-methods").set(auth(owner.token));

    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ id: other.id, isPrimary: true });
  });
});

describe("staff payout method routes", () => {
  it("lists drivers' payout methods by driver for payouts: read", async () => {
    const owner = await freshDriver();
    const method = await addPayoutMethod(owner, await paymentMethod(owner));
    await addPayoutMethod(otherDriver, await paymentMethod(otherDriver));

    const res = await api
      .get(`/admin/payout-methods?driverId=${owner.userId}`)
      .set(auth(payoutsReader.token));

    expectStatus(res, 200);
    expect(res.body.data.items.map((m: { id: string }) => m.id)).toEqual([method.id]);
    expect(res.body.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it("filters by automatic payouts", async () => {
    const owner = await freshDriver();
    const manual = await addPayoutMethod(owner, await paymentMethod(owner));
    const automatic = await addPayoutMethod(owner, await paymentMethod(owner, bankBody()), {
      isAutomatic: true,
    });

    const res = await api
      .get(`/admin/payout-methods?driverId=${owner.userId}&isAutomatic=true`)
      .set(auth(payoutsReader.token));

    expectStatus(res, 200);
    const ids = res.body.data.items.map((m: { id: string }) => m.id);
    expect(ids).toEqual([automatic.id]);
    expect(ids).not.toContain(manual.id);
  });

  it("needs the payouts module, not users", async () => {
    const asUsers = await api.get("/admin/payout-methods").set(auth(usersOnly.token));
    const asDriver = await api.get("/admin/payout-methods").set(auth(driver.token));

    expectStatus(asUsers, 403);
    expect(asUsers.body.error).toBe("Missing permission: read on payouts");
    expectStatus(asDriver, 403);
  });

  it("changes a driver's settings for payouts: update, and records it", async () => {
    const method = await addPayoutMethod(driver, await paymentMethod(driver));

    const denied = await api
      .patch(`/admin/payout-methods/${method.id}`)
      .set(auth(payoutsReader.token))
      .send({ isAutomatic: true });
    const res = await api
      .patch(`/admin/payout-methods/${method.id}`)
      .set(auth(payoutsAdmin.token))
      .send({ isAutomatic: true, minimumThreshold: 200 });
    const missing = await api
      .patch(`/admin/payout-methods/${randomUUID()}`)
      .set(auth(payoutsAdmin.token))
      .send({ isAutomatic: true });

    expectStatus(denied, 403);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ isAutomatic: true, minimumThreshold: 200 });
    expectStatus(missing, 404);

    await flushActivityLogs();
    const [entry] = await db("activityLogs")
      .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
      .where({ action: "payoutMethod.adminUpdate", targetId: method.id });
    expect(entry.module).toBe("payouts");
    expect(entry.changedFields).toEqual(
      expect.arrayContaining(["isAutomatic", "minimumThreshold"]),
    );
  });
});
