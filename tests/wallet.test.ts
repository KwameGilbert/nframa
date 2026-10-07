import { describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { failPaystackInitFor, forcePaystackResult, signPaystack } from "./helpers/paystack.js";
import { initializeTransaction } from "../src/services/paystack.service.js";
import { walletModel } from "../src/models/wallet.model.js";
import { settingModel } from "../src/models/setting.model.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { roundMoney } from "../src/utils/money.js";

type Rider = Awaited<ReturnType<typeof signUpByPhone>>;

// A rider whose wallet and transactions are cleaned up with them.
async function newRider() {
  const rider = await signUpByPhone("rider");
  trackForCleanup("transactions", { userId: rider.userId });
  trackForCleanup("wallets", { userId: rider.userId });
  return rider;
}

async function startTopUp(rider: Rider, amount: number) {
  const res = await api.post("/wallet/topup").set(auth(rider.token)).send({ amount });
  expectStatus(res, 201);
  return res.body.data as { reference: string; authorizationUrl: string; amount: number };
}

function chargeSuccess(reference: string, amountPesewas = 0) {
  return { event: "charge.success", data: { reference, amount: amountPesewas, currency: "GHS" } };
}

function sendWebhook(event: object, signature?: string) {
  const body = JSON.stringify(event);
  return api
    .post("/webhooks/paystack")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", signature ?? signPaystack(body))
    .send(body);
}

function transactionByReference(reference: string) {
  return db("transactions").where({ providerReference: reference }).first();
}

async function balanceOf(rider: Rider) {
  const res = await api.get("/wallet").set(auth(rider.token));
  expectStatus(res, 200);
  return res.body.data.balance as number;
}

describe("wallet routes without an access token", () => {
  it.each([
    ["get", "/wallet"],
    ["get", "/wallet/transactions"],
    ["post", "/wallet/topup"],
    ["post", "/wallet/topup/NF-abc/verify"],
  ] as const)("%s %s is 401", async (method, url) => {
    const res = await api[method](url).send({ amount: 10 });
    expectStatus(res, 401);
  });
});

describe("POST /wallet/topup", () => {
  it.each([
    ["missing", {}],
    ["negative", { amount: -5 }],
    ["zero", { amount: 0 }],
    ["a string", { amount: "50" }],
    ["more than 2 decimals", { amount: 10.005 }],
  ])("rejects an amount that is %s", async (_name, body) => {
    const rider = await newRider();

    const res = await api.post("/wallet/topup").set(auth(rider.token)).send(body);

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^amount: /);
    expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(0);
  });

  it("rejects amounts outside the wallet.minTopUp and wallet.maxTopUp settings", async () => {
    const rider = await newRider();
    const limits = await settingModel.getValues(["wallet.minTopUp", "wallet.maxTopUp"]);

    // Below a minimum of 0.01 or less there's no valid amount to try: 0 and negatives fail validation.
    if (limits["wallet.minTopUp"] >= 0.02) {
      const low = await api
        .post("/wallet/topup")
        .set(auth(rider.token))
        .send({ amount: roundMoney(limits["wallet.minTopUp"] - 0.01) });
      expectStatus(low, 400);
      expect(low.body.error).toBe(`Amount must be at least GHS ${limits["wallet.minTopUp"]}`);
    }
    const high = await api
      .post("/wallet/topup")
      .set(auth(rider.token))
      .send({ amount: roundMoney(limits["wallet.maxTopUp"] + 0.01) });

    expectStatus(high, 400);
    expect(high.body.error).toBe(`Amount must be at most GHS ${limits["wallet.maxTopUp"]}`);
    expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(0);
  });

  it("records a pending top-up and returns the Paystack checkout", async () => {
    const rider = await newRider();

    const res = await api.post("/wallet/topup").set(auth(rider.token)).send({ amount: 25.5 });

    expectStatus(res, 201);
    expect(res.body.message).toBe("Top-up started successfully");
    const { reference } = res.body.data;
    expect(reference).toMatch(/^NF-[0-9a-f]{24}$/);
    expect(res.body.data).toEqual({
      reference,
      authorizationUrl: `https://checkout.paystack.test/${reference}`,
      accessCode: `access-${reference}`,
      amount: 25.5,
      currency: "GHS",
    });
    // A phone-only rider has no email, so Paystack gets the stand-in one.
    expect(vi.mocked(initializeTransaction)).toHaveBeenCalledWith(
      expect.objectContaining({
        email: `${rider.userId}@example.com`,
        amountPesewas: 2550,
        reference,
      }),
    );

    const row = await transactionByReference(reference);
    expect(row).toMatchObject({
      userId: rider.userId,
      type: "topup",
      direction: "credit",
      amount: "25.50",
      currency: "GHS",
      status: "pending",
      provider: "paystack",
      balanceAfter: null,
    });
    expect(await balanceOf(rider)).toBe(0);

    await flushActivityLogs();
    const log = await db("activityLogs")
      .where({ action: "wallet.topup_initiated", targetId: row.id })
      .first();
    expect(log).toMatchObject({ module: "wallets", actorId: rider.userId, result: "success" });
  });

  it("marks the top-up failed and answers 502 when Paystack can't start the payment", async () => {
    const rider = await newRider();
    failPaystackInitFor(`${rider.userId}@example.com`);

    const res = await api.post("/wallet/topup").set(auth(rider.token)).send({ amount: 10 });

    expectStatus(res, 502);
    expect(res.body.error).toBe("Couldn't start the payment, try again");
    const rows = await db("transactions").where({ userId: rider.userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed" });
    expect(rows[0].metadata.failureReason).toBeTruthy();
  });
});

describe("POST /webhooks/paystack", () => {
  it("refuses a bad or missing signature without crediting anything", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 40);
    const event = chargeSuccess(reference);

    const forged = await sendWebhook(event, signPaystack(JSON.stringify(event), "not-the-secret"));
    const missing = await api.post("/webhooks/paystack").send(event);

    expectStatus(forged, 401);
    expect(forged.body.error).toBe("Invalid webhook signature");
    expectStatus(missing, 401);
    expect(await transactionByReference(reference)).toMatchObject({ status: "pending" });
    expect(await balanceOf(rider)).toBe(0);
  });

  it("credits the wallet with the recorded amount, whatever the event says", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 40);

    const res = await sendWebhook(chargeSuccess(reference, 999_999_00));

    expectStatus(res, 200);
    const row = await transactionByReference(reference);
    expect(row).toMatchObject({ status: "success", amount: "40.00", balanceAfter: "40.00" });

    const wallet = await api.get("/wallet").set(auth(rider.token));
    expect(wallet.body.data).toEqual({
      balance: 40,
      heldAmount: 0,
      availableBalance: 40,
      currency: "GHS",
    });

    await flushActivityLogs();
    const log = await db("activityLogs")
      .where({ action: "wallet.topup_settled", targetId: row.id })
      .first();
    expect(log).toMatchObject({ module: "wallets", actorId: rider.userId, result: "success" });
    expect(log.changedFields).toEqual(expect.arrayContaining(["status", "balanceAfter"]));
  });

  it("credits once however many times the same event arrives, even simultaneously", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 15.75);
    const event = chargeSuccess(reference);

    const responses = await Promise.all(Array.from({ length: 5 }, () => sendWebhook(event)));
    const late = await sendWebhook(event);

    for (const res of [...responses, late]) expectStatus(res, 200);
    expect(await balanceOf(rider)).toBe(15.75);
    const rows = await db("transactions").where({ userId: rider.userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "success", balanceAfter: "15.75" });

    await flushActivityLogs();
    const logs = await db("activityLogs").where({
      action: "wallet.topup_settled",
      targetId: rows[0].id,
    });
    expect(logs).toHaveLength(1);
  });

  it("answers 200 and does nothing for an unknown reference or another event", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 20);

    const unknown = await sendWebhook(chargeSuccess("NF-not-a-real-reference"));
    const other = await sendWebhook({ event: "transfer.success", data: { reference } });

    expectStatus(unknown, 200);
    expect(unknown.body.message).toBe("Webhook ignored");
    expectStatus(other, 200);
    expect(await transactionByReference(reference)).toMatchObject({ status: "pending" });
    expect(await balanceOf(rider)).toBe(0);
  });

  it.each([
    ["amount", { amountPesewas: 100 }],
    ["currency", { currency: "NGN" }],
  ])("marks the top-up failed, uncredited, when Paystack reports a different %s", async (_n, r) => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 30);
    forcePaystackResult(reference, r);

    const res = await sendWebhook(chargeSuccess(reference, 3000));

    expectStatus(res, 200);
    const row = await transactionByReference(reference);
    expect(row).toMatchObject({ status: "failed", balanceAfter: null });
    expect(row.metadata.failureReason).toMatch(/^Paystack reported/);
    expect(await balanceOf(rider)).toBe(0);

    await flushActivityLogs();
    const log = await db("activityLogs")
      .where({ action: "wallet.topup_failed", targetId: row.id })
      .first();
    expect(log).toMatchObject({
      module: "wallets",
      actorId: rider.userId,
      result: "failure",
      errorMessage: row.metadata.failureReason,
    });
    expect(log.requestBody.data).toBe("[REDACTED]");

    // Paystack correcting itself later doesn't revive a failed top-up.
    forcePaystackResult(reference, {});
    await sendWebhook(chargeSuccess(reference));
    expect(await balanceOf(rider)).toBe(0);
  });
});

describe("POST /wallet/topup/:reference/verify", () => {
  it("credits a paid top-up before the webhook arrives, and only once", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 60);

    const [first, webhook] = await Promise.all([
      api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token)),
      sendWebhook(chargeSuccess(reference)),
    ]);
    const again = await api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token));

    expectStatus(first, 200);
    expect(first.body.data).toMatchObject({
      providerReference: reference,
      status: "success",
      amount: 60,
      balanceAfter: 60,
    });
    expectStatus(again, 200);
    expect(again.body.data).toMatchObject({ status: "success", balanceAfter: 60 });
    expectStatus(webhook, 200);
    expect(await balanceOf(rider)).toBe(60);
  });

  it("keeps a declined top-up pending, so a retried payment on it is still credited once", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 18);
    forcePaystackResult(reference, { status: "failed" });

    const declined = await api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token));

    expectStatus(declined, 200);
    expect(declined.body.data).toMatchObject({ status: "pending", balanceAfter: null });

    forcePaystackResult(reference, {});
    const [webhook, verified] = await Promise.all([
      sendWebhook(chargeSuccess(reference)),
      api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token)),
    ]);

    expectStatus(webhook, 200);
    expectStatus(verified, 200);
    expect(verified.body.data).toMatchObject({ status: "success", balanceAfter: 18 });
    expect(await balanceOf(rider)).toBe(18);
    expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(1);
  });

  it("marks a reversed payment failed", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 9);
    forcePaystackResult(reference, { status: "reversed" });

    const res = await api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "failed", balanceAfter: null });
    expect(await balanceOf(rider)).toBe(0);
  });

  it("leaves a top-up pending while Paystack hasn't finished it", async () => {
    const rider = await newRider();
    const { reference } = await startTopUp(rider, 12);
    forcePaystackResult(reference, { status: "abandoned" });

    const res = await api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ status: "pending", balanceAfter: null });
    expect(await balanceOf(rider)).toBe(0);
  });

  it("404s for another rider's top-up and for an unknown reference", async () => {
    const [owner, other] = await Promise.all([newRider(), newRider()]);
    const { reference } = await startTopUp(owner, 10);

    const foreign = await api.post(`/wallet/topup/${reference}/verify`).set(auth(other.token));
    const unknown = await api.post("/wallet/topup/NF-nothing-here/verify").set(auth(other.token));

    expectStatus(foreign, 404);
    expect(foreign.body.error).toBe(`Top-up not found: ${reference}`);
    expectStatus(unknown, 404);
    expect(await transactionByReference(reference)).toMatchObject({ status: "pending" });
  });
});

describe("GET /wallet and /wallet/transactions", () => {
  it("shows an empty wallet to an account that never had money", async () => {
    const rider = await newRider();

    const res = await api.get("/wallet").set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.data).toEqual({
      balance: 0,
      heldAmount: 0,
      availableBalance: 0,
      currency: "GHS",
    });
  });

  it("lists only the caller's transactions, newest first, paged and filtered", async () => {
    const [rider, other] = await Promise.all([newRider(), newRider()]);
    for (const amount of [10, 20, 30]) {
      await walletModel.record({
        userId: rider.userId,
        type: "refund",
        direction: "credit",
        amount,
      });
    }
    await walletModel.record({
      userId: rider.userId,
      type: "trip_charge",
      direction: "debit",
      amount: 5,
    });
    await startTopUp(rider, 50); // pending
    await walletModel.record({
      userId: other.userId,
      type: "refund",
      direction: "credit",
      amount: 1,
    });

    const page1 = await api.get("/wallet/transactions?limit=2").set(auth(rider.token));
    const page3 = await api.get("/wallet/transactions?limit=2&page=3").set(auth(rider.token));
    const refunds = await api.get("/wallet/transactions?type=refund").set(auth(rider.token));
    const pending = await api.get("/wallet/transactions?status=pending").set(auth(rider.token));
    const bad = await api.get("/wallet/transactions?limit=101").set(auth(rider.token));

    expectStatus(page1, 200);
    expect(page1.body.data.pagination).toEqual({ page: 1, limit: 2, totalItems: 5, totalPages: 3 });
    expect(page1.body.data.items.map((t: { type: string }) => t.type)).toEqual([
      "topup",
      "trip_charge",
    ]);
    expect(page1.body.data.items[1]).toMatchObject({ amount: 5, balanceAfter: 55 });
    expect(page3.body.data.items).toHaveLength(1);
    expect(page3.body.data.items[0]).toMatchObject({ amount: 10, balanceAfter: 10 });
    expect(refunds.body.data.items.map((t: { amount: number }) => t.amount)).toEqual([30, 20, 10]);
    expect(pending.body.data.items).toHaveLength(1);
    expect(pending.body.data.items[0]).toMatchObject({ type: "topup", status: "pending" });
    for (const res of [page1, refunds, pending]) {
      for (const item of res.body.data.items) expect(item.userId).toBe(rider.userId);
    }
    expectStatus(bad, 400);
  });
});

describe("walletModel.record", () => {
  it("keeps the balance equal to the ledger under concurrent credits and debits", async () => {
    const rider = await newRider();
    const moves = [
      ...Array.from({ length: 10 }, (_, i) => ({ direction: "credit" as const, amount: 3.33 + i })),
      ...Array.from({ length: 10 }, (_, i) => ({ direction: "debit" as const, amount: 1.11 + i })),
    ];

    await Promise.all(
      moves.map(({ direction, amount }) =>
        walletModel.record({
          userId: rider.userId,
          type: direction === "credit" ? "refund" : "trip_charge",
          direction,
          amount,
        }),
      ),
    );

    const [{ sum }] = await db("transactions")
      .where({ userId: rider.userId, status: "success" })
      .select(
        db.raw(
          `coalesce(sum(case when direction = 'credit' then amount else -amount end), 0) as sum`,
        ),
      );
    const wallet = await db("wallets").where({ userId: rider.userId }).first();
    expect(Number(wallet.balance)).toBe(Number(sum));
    expect(Number(sum)).toBeCloseTo(10 * 3.33 + 45 - (10 * 1.11 + 45), 2);
    expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(moves.length);
  });

  it("lets a debit take the balance below zero", async () => {
    const rider = await newRider();
    await walletModel.record({
      userId: rider.userId,
      type: "refund",
      direction: "credit",
      amount: 5,
    });

    const debit = await walletModel.record({
      userId: rider.userId,
      type: "wait_charge",
      direction: "debit",
      amount: 7.5,
    });

    expect(debit).toMatchObject({ status: "success", amount: 7.5, balanceAfter: -2.5 });
    expect(await walletModel.getAvailableBalance(rider.userId)).toBe(-2.5);
  });
});

// Stubs the settings reader, which every request sees, so this runs on its own.
describe("top-up limits set the wrong way round", { concurrent: false }, () => {
  it("answers 503 instead of refusing every amount", async () => {
    const rider = await newRider();
    const spy = vi.spyOn(settingModel, "getValues").mockImplementation((async () => ({
      "wallet.minTopUp": 100,
      "wallet.maxTopUp": 50,
    })) as never);

    try {
      const res = await api.post("/wallet/topup").set(auth(rider.token)).send({ amount: 75 });

      expectStatus(res, 503);
      expect(res.body.error).toBe("Top-up limits are misconfigured");
      expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// Unsets the Paystack key, which every request sees, so this runs on its own.
describe("payments without PAYSTACK_SECRET_KEY", { concurrent: false }, () => {
  it("answers 503 to top-ups and webhooks without recording anything", async () => {
    const rider = await newRider();
    const secret = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY;

    try {
      const topUp = await api.post("/wallet/topup").set(auth(rider.token)).send({ amount: 10 });
      const webhook = await sendWebhook(chargeSuccess("NF-anything"), "some-signature");

      expectStatus(topUp, 503);
      expect(topUp.body.error).toBe("Payments are not configured");
      expectStatus(webhook, 503);
      expect(await db("transactions").where({ userId: rider.userId })).toHaveLength(0);
    } finally {
      process.env.PAYSTACK_SECRET_KEY = secret;
    }
  });
});
