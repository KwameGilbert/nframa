import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { walletModel } from "../src/models/wallet.model.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";

let verifier: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: update
let rider: Awaited<ReturnType<typeof signUpByPhone>>;

const HOUR = 60 * 60 * 1000;

// A driver whose wallet, ledger and payouts are cleaned up with them.
async function newDriver(funds = 0) {
  const driver = await signUpByPhone("driver");
  trackForCleanup("payouts", { driverUserId: driver.userId });
  trackForCleanup("transactions", { userId: driver.userId });
  trackForCleanup("wallets", { userId: driver.userId });
  if (funds > 0) {
    await walletModel.record({
      userId: driver.userId,
      type: "adjustmentCredit",
      direction: "credit",
      amount: funds,
    });
  }
  return driver;
}

// A verified mobile money number saved as the driver's payout method.
async function payoutMethod(owner: { token: string }, extra: object = {}) {
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

  const res = await api
    .post("/payout-methods")
    .set(auth(owner.token))
    .send({ paymentMethodId, ...extra });
  expectStatus(res, 201);
  trackForCleanup("payoutMethods", { id: res.body.data.id });
  return { id: res.body.data.id as string, paymentMethodId };
}

// A held driver earning, due at availableAt.
async function heldEarning(userId: string, amount: number, availableAt: Date) {
  const { transaction } = await db.transaction((trx) =>
    walletModel.move(trx, {
      userId,
      delta: { pendingBalance: amount },
      row: { type: "driverEarning", direction: "credit", amount, status: "pending", availableAt },
    }),
  );
  return transaction;
}

function requestPayout(driver: { token: string }, payoutMethodId: string, amount: number) {
  return api.post("/drivers/me/payouts").set(auth(driver.token)).send({ amount, payoutMethodId });
}

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  [verifier, rider] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { users: { update: true } }),
    signUpByPhone("rider"),
  ]);
});

describe("held earnings", () => {
  it("shows held credits as pendingBalance with the earliest release time, out of balance", async () => {
    const driver = await newDriver(10);
    const soon = new Date(Date.now() + HOUR);
    await heldEarning(driver.userId, 20, new Date(Date.now() + 2 * HOUR));
    await heldEarning(driver.userId, 5.5, soon);

    const res = await api.get("/wallet").set(auth(driver.token));
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      balance: 10,
      availableBalance: 10,
      pendingBalance: 25.5,
      nextReleaseAt: soon.toISOString(),
    });
  });

  it("releases only due credits into balance, settling each row", async () => {
    const driver = await newDriver();
    const due = await heldEarning(driver.userId, 12, new Date(Date.now() - 1000));
    const later = await heldEarning(driver.userId, 8, new Date(Date.now() + HOUR));

    expect(await walletModel.releaseDueEarnings(driver.userId)).toBe(1);
    expect(await walletModel.releaseDueEarnings(driver.userId)).toBe(0);

    expect(await walletModel.getWallet(driver.userId)).toMatchObject({
      balance: 12,
      pendingBalance: 8,
      nextReleaseAt: later.availableAt,
    });
    const rows = await db("transactions").whereIn("id", [due.id, later.id]).orderBy("amount");
    expect(rows.map((r) => [Number(r.amount), r.status, Number(r.balanceAfter)])).toEqual([
      [8, "pending", 0],
      [12, "success", 12],
    ]);
  });

  it("releases a frozen wallet's due credits too", async () => {
    const driver = await newDriver();
    await heldEarning(driver.userId, 4, new Date(Date.now() - 1000));
    await db("wallets").where({ userId: driver.userId }).update({ status: "frozen" });

    expect(await walletModel.releaseDueEarnings(driver.userId)).toBe(1);
    expect(await walletModel.getWallet(driver.userId)).toMatchObject({
      balance: 4,
      pendingBalance: 0,
      nextReleaseAt: null,
    });
  });
});

describe("ledger is append-only", () => {
  it("refuses to delete a row or change a settled one", async () => {
    const driver = await newDriver(3);
    const row = await db("transactions").where({ userId: driver.userId }).first();

    await expect(db("transactions").where({ id: row.id }).del()).rejects.toThrow(
      /append-only: rows cannot be deleted/,
    );
    await expect(db("transactions").where({ id: row.id }).update({ amount: 300 })).rejects.toThrow(
      /append-only: only a pending row can settle/,
    );
    await expect(
      db("transactions").where({ id: row.id }).update({ status: "failed" }),
    ).rejects.toThrow(/append-only/);
  });
});

describe("POST /drivers/me/payouts", () => {
  it("takes the amount out of balance as a pending payout debit, releasing due earnings first", async () => {
    const driver = await newDriver(10);
    const method = await payoutMethod(driver);
    await heldEarning(driver.userId, 15, new Date(Date.now() - 1000));

    const res = await requestPayout(driver, method.id, 20);
    expectStatus(res, 201);
    expect(res.body.message).toBe("Payout requested successfully");
    expect(res.body.data).toMatchObject({
      driverUserId: driver.userId,
      payoutMethodId: method.id,
      amount: 20,
      status: "pending",
    });

    expect(await walletModel.getWallet(driver.userId)).toMatchObject({
      balance: 5,
      pendingBalance: 0,
    });
    const debit = await db("transactions").where({ id: res.body.data.transactionId }).first();
    expect(debit).toMatchObject({
      userId: driver.userId,
      type: "payout",
      direction: "debit",
      status: "pending",
      metadata: { payoutMethodId: method.id },
    });
    expect(Number(debit.balanceAfter)).toBe(5);

    const list = await api.get("/drivers/me/payouts").set(auth(driver.token));
    expectStatus(list, 200);
    expect(list.body.data.items.map((p: { id: string }) => p.id)).toEqual([res.body.data.id]);
  });

  it("refuses a second payout while one is waiting", async () => {
    const driver = await newDriver(50);
    const method = await payoutMethod(driver);
    expectStatus(await requestPayout(driver, method.id, 10), 201);

    const res = await requestPayout(driver, method.id, 10);
    expectStatus(res, 409);
    expect(res.body.error).toBe("You already have a payout waiting to be paid");
    expect(await walletModel.getAvailableBalance(driver.userId)).toBe(40);
  });

  it("refuses more than the available balance, not counting earnings still on hold", async () => {
    const driver = await newDriver(10);
    const method = await payoutMethod(driver);
    await heldEarning(driver.userId, 30, new Date(Date.now() + HOUR));

    const res = await requestPayout(driver, method.id, 10.01);
    expectStatus(res, 409);
    expect(res.body.error).toBe("Insufficient wallet balance");
    expect(await db("payouts").where({ driverUserId: driver.userId })).toHaveLength(0);
  });

  it("refuses a frozen wallet (423)", async () => {
    const driver = await newDriver(10);
    const method = await payoutMethod(driver);
    await db("wallets").where({ userId: driver.userId }).update({ status: "frozen" });

    const res = await requestPayout(driver, method.id, 5);
    expectStatus(res, 423);
    expect(res.body.error).toBe("This wallet is frozen");
    expect(await walletModel.getWallet(driver.userId)).toMatchObject({ balance: 10 });
  });

  it("refuses less than the method's minimum", async () => {
    const driver = await newDriver(100);
    const method = await payoutMethod(driver, { minimumThreshold: 50 });

    const res = await requestPayout(driver, method.id, 49.99);
    expectStatus(res, 409);
    expect(res.body.error).toBe("The minimum payout to this method is GHS 50");
  });

  it("refuses a method whose payment method is no longer verified", async () => {
    const driver = await newDriver(10);
    const method = await payoutMethod(driver);
    await api
      .patch(`/admin/payment-methods/${method.paymentMethodId}`)
      .set(auth(verifier.token))
      .send({ verificationStatus: "failed" })
      .expect(200);

    const res = await requestPayout(driver, method.id, 5);
    expectStatus(res, 409);
    expect(res.body.error).toBe(
      "Verify this payout method's payment method before requesting a payout",
    );
  });

  it("404s another driver's or an unknown payout method", async () => {
    const driver = await newDriver(10);
    const other = await newDriver();
    const theirs = await payoutMethod(other);

    const res = await requestPayout(driver, theirs.id, 5);
    expectStatus(res, 404);
    expect(res.body.error).toBe(`Payout method not found: ${theirs.id}`);
  });

  it("is for drivers only", async () => {
    const res = await requestPayout(rider, "00000000-0000-4000-8000-000000000000", 5);
    expectStatus(res, 403);
    expect(res.body.error).toBe("Only drivers can request payouts");
  });

  it("rejects an amount with more than 2 decimal places", async () => {
    const driver = await newDriver(10);
    const method = await payoutMethod(driver);
    expectStatus(await requestPayout(driver, method.id, 1.005), 400);
  });
});

describe("POST /drivers/me/payouts/:id/cancel", () => {
  it("puts the amount back and fails the debit; a second cancel is refused", async () => {
    const driver = await newDriver(30);
    const method = await payoutMethod(driver);
    const requested = await requestPayout(driver, method.id, 25);
    expectStatus(requested, 201);
    const { id, transactionId } = requested.body.data;

    const res = await api.post(`/drivers/me/payouts/${id}/cancel`).set(auth(driver.token));
    expectStatus(res, 200);
    expect(res.body.message).toBe("Payout cancelled successfully");
    expect(res.body.data).toMatchObject({ id, status: "cancelled" });
    expect(await walletModel.getWallet(driver.userId)).toMatchObject({ balance: 30 });
    const debit = await db("transactions").where({ id: transactionId }).first();
    expect(debit.status).toBe("failed");
    expect(Number(debit.balanceAfter)).toBe(30);

    const again = await api.post(`/drivers/me/payouts/${id}/cancel`).set(auth(driver.token));
    expectStatus(again, 409);
    expect(await walletModel.getWallet(driver.userId)).toMatchObject({ balance: 30 });

    // With the first one cancelled, a new payout can be requested.
    expectStatus(await requestPayout(driver, method.id, 5), 201);
  });

  it("404s another driver's payout", async () => {
    const owner = await newDriver(10);
    const method = await payoutMethod(owner);
    const requested = await requestPayout(owner, method.id, 5);
    expectStatus(requested, 201);
    const driver = await newDriver();

    const res = await api
      .post(`/drivers/me/payouts/${requested.body.data.id}/cancel`)
      .set(auth(driver.token));
    expectStatus(res, 404);
    expect(res.body.error).toBe(`Payout not found: ${requested.body.data.id}`);
  });
});
