import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { walletModel } from "../src/models/wallet.model.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";

type SignedInAdmin = Awaited<ReturnType<typeof createSignedInAdmin>>;
type Account = Awaited<ReturnType<typeof signUpByPhone>>;

let viewer: SignedInAdmin; // finance: read
let outsider: SignedInAdmin; // trips: read, nothing on finance
let verifier: SignedInAdmin; // users: update
let rider: Account;
let driver: Account;
let payoutId: string;

const todayUtc = () => new Date().toISOString().slice(0, 10);

// An account whose wallet, ledger and payouts are cleaned up with it.
async function newAccount(role: "rider" | "driver", funds: number) {
  const account = await signUpByPhone(role);
  trackForCleanup("payouts", { driverUserId: account.userId });
  trackForCleanup("transactions", { userId: account.userId });
  trackForCleanup("wallets", { userId: account.userId });
  await walletModel.record({
    userId: account.userId,
    type: "adjustmentCredit",
    direction: "credit",
    amount: funds,
  });
  return account;
}

// A verified mobile money number saved as the driver's payout method.
async function payoutMethod(owner: { token: string }) {
  const pm = await api
    .post("/payment-methods")
    .set(auth(owner.token))
    .send({ type: "mobile_money", network: "mtn", phoneNumber: `+233${data.ghanaPhoneNumber()}` });
  expectStatus(pm, 201);
  const paymentMethodId = pm.body.data.id as string;
  trackForCleanup("paymentMethods", { id: paymentMethodId });
  await api
    .patch(`/admin/payment-methods/${paymentMethodId}`)
    .set(auth(verifier.token))
    .send({ verificationStatus: "verified" })
    .expect(200);

  const res = await api.post("/payout-methods").set(auth(owner.token)).send({ paymentMethodId });
  expectStatus(res, 201);
  trackForCleanup("payoutMethods", { id: res.body.data.id });
  return res.body.data.id as string;
}

function get(path: string, token: string, query: Record<string, string | number> = {}) {
  return api.get(path).query(query).set(auth(token));
}

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  [viewer, outsider, verifier] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { finance: { read: true } }),
    createSignedInAdmin(superAdmin.token, { trips: { read: true } }),
    createSignedInAdmin(superAdmin.token, { users: { update: true } }),
  ]);
  [rider, driver] = await Promise.all([newAccount("rider", 40), newAccount("driver", 100)]);

  const payout = await api
    .post("/drivers/me/payouts")
    .set(auth(driver.token))
    .send({ amount: 30, payoutMethodId: await payoutMethod(driver) });
  expectStatus(payout, 201);
  payoutId = payout.body.data.id;
});

describe("access", () => {
  const paths = [
    "/admin/finance/overview",
    "/admin/finance/transactions",
    "/admin/finance/wallets",
    "/admin/finance/payouts",
  ];

  it("needs a token", async () => {
    for (const path of paths) expectStatus(await api.get(path), 401);
  });

  it("needs finance: read", async () => {
    for (const path of paths) expectStatus(await get(path, outsider.token), 403);
  });
});

describe("GET /admin/finance/overview", () => {
  it("returns the stats, liabilities, payouts and 7 days of cash flow", async () => {
    const res = await get("/admin/finance/overview", viewer.token);
    expectStatus(res, 200);
    const { stats, liabilities, payouts, frozenWallets, cashFlow } = res.body.data;

    for (const key of ["gmv", "revenue", "gmvToday", "revenueToday"]) {
      expect(typeof stats[key]).toBe("number");
    }
    expect(liabilities.total).toBeCloseTo(
      liabilities.riderBalances + liabilities.driverAvailable + liabilities.driverPending,
      2,
    );
    expect(liabilities.riderBalances).toBeGreaterThanOrEqual(40);
    expect(payouts.pending.count).toBeGreaterThanOrEqual(1);
    expect(payouts.pending.amount).toBeGreaterThanOrEqual(30);
    expect(Number.isInteger(frozenWallets)).toBe(true);

    expect(cashFlow).toHaveLength(7);
    expect(cashFlow.at(-1).date).toBe(todayUtc());
    for (const day of cashFlow) {
      expect(day).toEqual({ date: expect.any(String), inflow: expect.any(Number), outflow: expect.any(Number) });
    }
  });
});

describe("GET /admin/finance/transactions", () => {
  it("filters by user, with the owner and totals over the filtered set", async () => {
    const res = await get("/admin/finance/transactions", viewer.token, { userId: driver.userId });
    expectStatus(res, 200);
    const { items, pagination, totals } = res.body.data;

    expect(pagination.totalItems).toBe(2);
    expect(items.map((t: { type: string }) => t.type)).toEqual(["payout", "adjustmentCredit"]);
    expect(items[0]).toMatchObject({
      userId: driver.userId,
      account: "user",
      user: { id: driver.userId, fullName: driver.fullName, role: "driver" },
    });
    expect(totals).toEqual({ credits: 100, debits: 30 });
  });

  it("filters by type, direction and search", async () => {
    const res = await get("/admin/finance/transactions", viewer.token, {
      search: driver.fullName,
      direction: "debit",
      type: "payout",
    });
    expectStatus(res, 200);
    const ids = res.body.data.items.map((t: { userId: string }) => t.userId);
    expect(ids).toContain(driver.userId);
    expect(ids).not.toContain(rider.userId);
  });

  it("rejects from after to", async () => {
    const res = await get("/admin/finance/transactions", viewer.token, {
      from: "2026-10-02T00:00:00Z",
      to: "2026-10-01T00:00:00Z",
    });
    expectStatus(res, 400);
  });
});

describe("GET /admin/finance/transactions/:id", () => {
  it("returns one transaction", async () => {
    const list = await get("/admin/finance/transactions", viewer.token, { userId: rider.userId });
    const id = list.body.data.items[0].id;

    const res = await get(`/admin/finance/transactions/${id}`, viewer.token);
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ id, amount: 40, user: { id: rider.userId, role: "rider" } });
  });

  it("404s on an unknown id", async () => {
    expectStatus(await get(`/admin/finance/transactions/${randomUUID()}`, viewer.token), 404);
  });
});

describe("GET /admin/finance/wallets", () => {
  it("lists wallets by role and search, with lifetime figures", async () => {
    const res = await get("/admin/finance/wallets", viewer.token, { role: "driver", search: driver.fullName });
    expectStatus(res, 200);
    const wallet = res.body.data.items.find((w: { userId: string }) => w.userId === driver.userId);
    expect(wallet).toMatchObject({
      balance: 70,
      status: "active",
      lifetimeTopUps: 0,
      user: { id: driver.userId, role: "driver" },
    });
    expect(wallet.lastActivityAt).not.toBeNull();
    for (const item of res.body.data.items) expect(item.user.role).toBe("driver");
  });

  it("leaves riders out of a driver search", async () => {
    const res = await get("/admin/finance/wallets", viewer.token, { role: "driver", search: rider.fullName });
    expectStatus(res, 200);
    const ids = res.body.data.items.map((w: { userId: string }) => w.userId);
    expect(ids).not.toContain(rider.userId);
  });
});

describe("GET /admin/finance/wallets/:userId/transactions", () => {
  it("lists one wallet's ledger", async () => {
    const res = await get(`/admin/finance/wallets/${rider.userId}/transactions`, viewer.token);
    expectStatus(res, 200);
    expect(res.body.data.pagination.totalItems).toBe(1);
    expect(res.body.data.totals).toEqual({ credits: 40, debits: 0 });
  });

  it("404s on a user without a wallet", async () => {
    expectStatus(await get(`/admin/finance/wallets/${randomUUID()}/transactions`, viewer.token), 404);
  });
});

describe("GET /admin/finance/payouts", () => {
  it("lists the pending queue with the driver and payout method", async () => {
    const res = await get("/admin/finance/payouts", viewer.token, { status: "pending", search: driver.fullName });
    expectStatus(res, 200);
    const payout = res.body.data.items.find((p: { id: string }) => p.id === payoutId);
    expect(payout).toMatchObject({
      amount: 30,
      status: "pending",
      driver: { id: driver.userId, fullName: driver.fullName },
      payoutMethod: { type: "mobile_money", displayName: expect.any(String) },
    });
    for (const item of res.body.data.items) expect(item.status).toBe("pending");
  });

  it("leaves it out of other statuses", async () => {
    const res = await get("/admin/finance/payouts", viewer.token, { status: "paid", search: driver.fullName });
    expectStatus(res, 200);
    expect(res.body.data.items.map((p: { id: string }) => p.id)).not.toContain(payoutId);
  });
});
