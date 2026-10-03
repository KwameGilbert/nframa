import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { signUpByPhone, loginAsSuperAdmin, createSignedInAdmin } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { generateUuid, generatePhone } from "./helpers/unique.js";

describe("Payment Methods", () => {
  let riderToken: string;
  let riderUserId: string;
  let driverToken: string;
  let driverUserId: string;
  let adminToken: string;

  beforeAll(async () => {
    // Create a rider and driver
    const rider = await signUpByPhone("rider");
    riderToken = rider.token;
    riderUserId = rider.userId;
    trackForCleanup("users", { id: riderUserId });

    const driver = await signUpByPhone("driver");
    driverToken = driver.token;
    driverUserId = driver.userId;
    trackForCleanup("users", { id: driverUserId });

    // Create admin
    const superAdmin = await loginAsSuperAdmin();
    adminToken = (await createSignedInAdmin(superAdmin.token, { users: { read: true } })).token;
  });

  afterAll(async () => {
    // Logged out via api
  });

  it("rider can add a card payment method", async () => {
    const res = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        displayName: "My Visa",
        tokenizedReference: "token_visa_12345",
        metadata: {
          lastFourDigits: "4242",
          expiryMonth: 12,
          expiryYear: 2026,
        },
      });

    expectStatus(res, 201);
    expect(res.body.data).toMatchObject({
      type: "card",
      displayName: "My Visa",
      isVerified: false,
      verificationStatus: "pending",
    });
    expect(res.body.data.id).toBeDefined();
    trackForCleanup("paymentMethods", { id: res.body.data.id });
  });

  it("driver can add mobile money method", async () => {
    const res = await api
      .post("/payment-methods")
      .set(auth(driverToken))
      .send({
        type: "mobile_money",
        provider: "hubtel",
        tokenizedReference: "momo_token_12345",
        metadata: {
          phoneNumber: "+233541234567",
          operator: "mtn",
        },
      });

    expectStatus(res, 201);
    expect(res.body.data.type).toBe("mobile_money");
    trackForCleanup("paymentMethods", { id: res.body.data.id });
  });

  it("user can list their payment methods", async () => {
    // Add a method first
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_list_test",
        metadata: { lastFourDigits: "5555", expiryMonth: 3, expiryYear: 2027 },
      });
    trackForCleanup("paymentMethods", { id: add.body.data.id });

    const res = await api.get("/payment-methods").set(auth(riderToken));

    expectStatus(res, 200);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0]).toHaveProperty("id");
    expect(res.body.data.items[0]).toHaveProperty("type");
  });

  it("user can get payment method details", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_detail_test",
        metadata: { lastFourDigits: "6666", expiryMonth: 6, expiryYear: 2028 },
      });
    const methodId = add.body.data.id;
    trackForCleanup("paymentMethods", { id: methodId });

    const res = await api.get(`/payment-methods/${methodId}`).set(auth(riderToken));

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      id: methodId,
      type: "card",
      isVerified: false,
    });
  });

  it("user can update payment method display name", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        displayName: "Old Name",
        tokenizedReference: "token_update_test",
        metadata: { lastFourDigits: "7777", expiryMonth: 9, expiryYear: 2025 },
      });
    const methodId = add.body.data.id;
    trackForCleanup("paymentMethods", { id: methodId });

    const res = await api
      .patch(`/payment-methods/${methodId}`)
      .set(auth(riderToken))
      .send({ displayName: "New Name" });

    expectStatus(res, 200);
    expect(res.body.data.displayName).toBe("New Name");
  });

  it("user can set payment method as primary", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_primary_test",
        metadata: { lastFourDigits: "8888", expiryMonth: 11, expiryYear: 2026 },
      });
    const methodId = add.body.data.id;
    trackForCleanup("paymentMethods", { id: methodId });

    const res = await api
      .patch(`/payment-methods/${methodId}`)
      .set(auth(riderToken))
      .send({ isPrimary: true });

    expectStatus(res, 200);
    expect(res.body.data.isPrimary).toBe(true);
  });

  it("user can verify payment method with OTP", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_verify_test",
        metadata: { lastFourDigits: "9999", expiryMonth: 1, expiryYear: 2027 },
      });
    const methodId = add.body.data.id;
    trackForCleanup("paymentMethods", { id: methodId });

    const res = await api
      .post(`/payment-methods/${methodId}/verify`)
      .set(auth(riderToken))
      .send({ verificationToken: "123456" });

    expectStatus(res, 200);
    expect(res.body.data.isVerified).toBe(true);
  });

  it("user can delete (soft delete) payment method", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_delete_test",
        metadata: { lastFourDigits: "0000", expiryMonth: 2, expiryYear: 2028 },
      });
    const methodId = add.body.data.id;
    trackForCleanup("paymentMethods", { id: methodId });

    const delRes = await api.delete(`/payment-methods/${methodId}`).set(auth(riderToken));
    expectStatus(delRes, 200);

    const getRes = await api.get(`/payment-methods/${methodId}`).set(auth(riderToken));
    expectStatus(getRes, 404);
  });

  it("user cannot access another user's payment method", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_access_test",
        metadata: { lastFourDigits: "1111", expiryMonth: 4, expiryYear: 2025 },
      });
    const methodId = add.body.data.id;
    trackForCleanup("paymentMethods", { id: methodId });

    const res = await api.get(`/payment-methods/${methodId}`).set(auth(driverToken));
    expectStatus(res, 404);
  });

  it("admin can list user's payment methods", async () => {
    const add = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: "token_admin_list",
        metadata: { lastFourDigits: "2222", expiryMonth: 5, expiryYear: 2029 },
      });
    trackForCleanup("paymentMethods", { id: add.body.data.id });

    const res = await api.get("/payment-methods/admin/users").set(auth(adminToken));

    expectStatus(res, 200);
    expect(res.body.data.items).toBeInstanceOf(Array);
  });

  it("rejects duplicate payment method (unique constraint)", async () => {
    const token = "token_unique_test";

    const res1 = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: token,
        metadata: { lastFourDigits: "3333", expiryMonth: 7, expiryYear: 2026 },
      });
    expectStatus(res1, 201);
    trackForCleanup("paymentMethods", { id: res1.body.data.id });

    const res2 = await api
      .post("/payment-methods")
      .set(auth(riderToken))
      .send({
        type: "card",
        provider: "paystack",
        tokenizedReference: token,
        metadata: { lastFourDigits: "3333", expiryMonth: 7, expiryYear: 2026 },
      });
    expectStatus(res2, 409);
  });
});
