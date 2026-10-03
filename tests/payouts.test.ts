import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { signUpByPhone, loginAsSuperAdmin, createSignedInAdmin } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";

describe("Payouts", () => {
  let driverToken: string;
  let driverUserId: string;
  let adminToken: string;
  let paymentMethodId: string;

  beforeAll(async () => {
    // Create driver
    const driver = await signUpByPhone("driver");
    driverToken = driver.token;
    driverUserId = driver.userId;
    trackForCleanup("users", { id: driverUserId });

    // Create verified payment method for driver
    const methodRes = await api
      .post("/payment-methods")
      .set(auth(driverToken))
      .send({
        type: "mobile_money",
        provider: "hubtel",
        tokenizedReference: "momo_payout_test",
        metadata: { phoneNumber: "+233541234567", operator: "mtn" },
      });
    paymentMethodId = methodRes.body.data.id;
    trackForCleanup("paymentMethods", { id: paymentMethodId });

    // Verify it
    await api
      .post(`/payment-methods/${paymentMethodId}/verify`)
      .set(auth(driverToken))
      .send({ verificationToken: "123456" });

    // Create admin
    const superAdmin = await loginAsSuperAdmin();
    adminToken = (await createSignedInAdmin(superAdmin.token, { payouts: { read: true, update: true } }))
      .token;
  });

  afterAll(async () => {
    // Cleanup
  });

  it("driver can add a payout method with verified payment method", async () => {
    const res = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId,
        isAutomatic: false,
        minimumThreshold: 50.0,
      });

    expectStatus(res, 201);
    expect(res.body.data).toMatchObject({
      paymentMethodId,
      isAutomatic: false,
      minimumThreshold: 50,
    });
    trackForCleanup("payoutMethods", { id: res.body.data.id });
  });

  it("driver cannot add payout method with unverified payment method", async () => {
    // Create unverified payment method
    const methodRes = await api
      .post("/payment-methods")
      .set(auth(driverToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_unverified_payout",
        metadata: { lastFourDigits: "4444", expiryMonth: 8, expiryYear: 2026 },
      });
    const unverifiedId = methodRes.body.data.id;
    trackForCleanup("paymentMethods", { id: unverifiedId });

    const res = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId: unverifiedId,
        isAutomatic: false,
      });

    expectStatus(res, 400);
  });

  it("driver can list their payout methods", async () => {
    // Add one first
    const addRes = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId,
        isAutomatic: false,
        minimumThreshold: 50.0,
      });
    trackForCleanup("payoutMethods", { id: addRes.body.data.id });

    const res = await api.get("/payouts/methods").set(auth(driverToken));

    expectStatus(res, 200);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it("driver can set payout method as primary", async () => {
    const addRes = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId,
        isAutomatic: false,
      });
    const methodId = addRes.body.data.id;
    trackForCleanup("payoutMethods", { id: methodId });

    const res = await api
      .patch(`/payouts/methods/${methodId}`)
      .set(auth(driverToken))
      .send({ isPrimary: true });

    expectStatus(res, 200);
    expect(res.body.data.isPrimary).toBe(true);
  });

  it("driver can enable automatic payouts", async () => {
    const addRes = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId,
        isAutomatic: false,
      });
    const methodId = addRes.body.data.id;
    trackForCleanup("payoutMethods", { id: methodId });

    const res = await api
      .patch(`/payouts/methods/${methodId}`)
      .set(auth(driverToken))
      .send({
        isAutomatic: true,
        minimumThreshold: 100.0,
        payoutFrequency: "weekly",
      });

    expectStatus(res, 200);
    expect(res.body.data.isAutomatic).toBe(true);
    expect(res.body.data.minimumThreshold).toBe(100);
  });

  it("driver can get payout history", async () => {
    const res = await api.get("/payouts/history").set(auth(driverToken));

    expectStatus(res, 200);
    expect(res.body.data).toHaveProperty("items");
    expect(res.body.data).toHaveProperty("pagination");
  });

  it("driver can get payout stats", async () => {
    const res = await api.get("/payouts/stats").set(auth(driverToken));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      totalPaid: expect.any(Number),
      totalPending: expect.any(Number),
      totalFailed: expect.any(Number),
    });
  });

  it("driver cannot trigger payout without balance", async () => {
    const addRes = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId,
        isAutomatic: false,
      });
    const methodId = addRes.body.data.id;
    trackForCleanup("payoutMethods", { id: methodId });

    const res = await api
      .post(`/payouts/methods/${methodId}/trigger`)
      .set(auth(driverToken))
      .send({});

    // Expect either 409 (insufficient balance) or 400
    expect([400, 409]).toContain(res.status);
  });

  it("admin can list driver payout methods", async () => {
    const addRes = await api
      .post("/payouts/methods")
      .set(auth(driverToken))
      .send({
        paymentMethodId,
        isAutomatic: false,
      });
    trackForCleanup("payoutMethods", { id: addRes.body.data.id });

    const res = await api
      .get(`/payouts/admin/users/${driverUserId}/methods`)
      .set(auth(adminToken));

    expectStatus(res, 200);
    expect(res.body.data.items).toBeInstanceOf(Array);
  });

  it("admin can view driver payout history", async () => {
    const res = await api
      .get(`/payouts/admin/users/${driverUserId}/history`)
      .set(auth(adminToken));

    expectStatus(res, 200);
    expect(res.body.data).toHaveProperty("items");
    expect(res.body.data).toHaveProperty("pagination");
  });

  it("admin can view driver payout stats", async () => {
    const res = await api
      .get(`/payouts/admin/users/${driverUserId}/stats`)
      .set(auth(adminToken));

    expectStatus(res, 200);
    expect(res.body.data).toHaveProperty("totalPaid");
  });

  it("admin cannot trigger payout for driver without primary method", async () => {
    // Create another driver without payout method
    const other = await signUpByPhone("driver");
    const otherToken = other.token;
    const otherUserId = other.userId;
    trackForCleanup("users", { id: otherUserId });

    const res = await api
      .post(`/payouts/admin/users/${otherUserId}/trigger`)
      .set(auth(adminToken))
      .send({});

    expectStatus(res, 400);
  });

  it("non-driver cannot add payout method", async () => {
    const rider = await signUpByPhone("rider");
    trackForCleanup("users", { id: rider.userId });

    const res = await api
      .post("/payouts/methods")
      .set(auth(rider.token))
      .send({
        paymentMethodId,
        isAutomatic: false,
      });

    expectStatus(res, 403);
  });
});
