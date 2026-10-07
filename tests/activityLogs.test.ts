import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { newEmail, newPromotion } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";

type SignedInAdmin = Awaited<ReturnType<typeof createSignedInAdmin>>;

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let auditor: SignedInAdmin; // activityLogs: read
let settingsManager: SignedInAdmin; // full settings access, nothing on activityLogs

async function newSettingKey() {
  return `${(await newPromotion()).keyPrefix}.discountPercent`;
}

async function createSetting(token: string, key: string, value = 10) {
  const res = await api.post("/settings").set(auth(token)).send({ key, type: "number", value });
  expectStatus(res, 201);
  trackForCleanup("settings", { key });
}

// Entries are written just after each response goes out, so wait for them before reading.
async function findLogs(query: Record<string, string | number>) {
  await flushActivityLogs();
  const res = await api.get("/admin/activity-logs").query(query).set(auth(auditor.token));
  expectStatus(res, 200);
  return res.body.data;
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [auditor, settingsManager] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { activityLogs: { read: true } }),
    createSignedInAdmin(superAdmin.token, {
      settings: { create: true, read: true, update: true, delete: true },
    }),
  ]);
});

describe("recording", () => {
  it("records a creation: who, what, where from, and the created record", async () => {
    const key = await newSettingKey();
    await createSetting(settingsManager.token, key);

    const { items } = await findLogs({ targetType: "setting", targetId: key });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actorId: settingsManager.userId,
      actor: {
        id: settingsManager.userId,
        fullName: settingsManager.fullName,
        email: settingsManager.email,
        role: "admin",
      },
      module: "settings",
      action: "setting.create",
      description: "Created a setting",
      targetType: "setting",
      targetId: key,
      result: "success",
      errorMessage: null,
      method: "POST",
      path: "/settings",
      requestBody: { key, type: "number", value: 10 },
      before: null,
      after: { key, type: "number", value: 10, updatedBy: settingsManager.userId },
      changedFields: null,
    });
    expect(items[0].requestId).toEqual(expect.any(String));
    expect(items[0].ipAddress).toEqual(expect.any(String));
  });

  it("records an update's before and after, and which fields changed", async () => {
    const key = await newSettingKey();
    await createSetting(settingsManager.token, key, 10);
    expectStatus(
      await api.patch(`/settings/${key}`).set(auth(settingsManager.token)).send({ value: 15 }),
      200,
    );

    const { items } = await findLogs({ action: "setting.update", targetId: key });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      before: { key, value: 10 },
      after: { key, value: 15 },
      changedFields: ["value"],
    });
  });

  it("records a deletion with the record as it was", async () => {
    const key = await newSettingKey();
    await createSetting(settingsManager.token, key, 12);
    expectStatus(await api.delete(`/settings/${key}`).set(auth(settingsManager.token)), 200);

    const { items } = await findLogs({ action: "setting.delete", targetId: key });

    expect(items[0]).toMatchObject({ result: "success", before: { key, value: 12 }, after: null });
  });

  it("records nothing for a request refused before anything changed", async () => {
    const key = await newSettingKey();
    await createSetting(settingsManager.token, key);
    expectStatus(
      await api.patch(`/settings/${key}`).set(auth(auditor.token)).send({ value: 99 }),
      403,
    );

    const { items } = await findLogs({ targetId: key });

    expect(items.map((item: { action: string }) => item.action)).toEqual(["setting.create"]);
  });

  it("records a sign-up with the new account, without the code", async () => {
    const rider = await signUpByPhone("rider");

    const { items } = await findLogs({ action: "auth.signup", targetId: rider.userId });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actorId: rider.userId,
      module: "auth",
      description: "Signed up as a rider with a verification code",
      targetType: "user",
      requestBody: { code: "[REDACTED]", role: "rider" },
      before: null,
      after: { id: rider.userId, role: "rider", isPhoneVerified: true },
    });
  });

  it("records a rider's changes to their own account", async () => {
    // Signing up names the account with a PATCH /users/:id as the rider.
    const rider = await signUpByPhone("rider");

    const { items } = await findLogs({ action: "user.update", targetId: rider.userId });

    expect(items[0]).toMatchObject({
      actorId: rider.userId,
      actor: { role: "rider", fullName: rider.fullName },
      module: "users",
      before: { fullName: null },
      after: { fullName: rider.fullName },
      changedFields: ["fullName"],
    });
  });

  it("records nested changes as dotted paths", async () => {
    const driver = await signUpByPhone("driver");
    expectStatus(
      await api.post("/driver").set(auth(driver.token)).send({ userId: driver.userId }),
      201,
    );
    trackForCleanup("carOwnerProfiles", { userId: driver.userId });
    expectStatus(
      await api
        .patch(`/admin/driver/${driver.userId}/verification`)
        .set(auth(superAdmin.token))
        .send({ verificationStatus: "rejected" }),
      200,
    );

    const { items } = await findLogs({
      action: "verification.driver.update",
      targetId: driver.userId,
    });

    expect(items[0].changedFields).toContain("driver.verificationStatus");
    expect(items[0].after.driver.verificationStatus).toBe("rejected");
  });

  it.skip("records a document review, and the driver status change it caused as its own entry", async () => {
    const driver = await signUpByPhone("driver");
    expectStatus(
      await api.post("/driver").set(auth(driver.token)).send({ userId: driver.userId }),
      201,
    );
    trackForCleanup("carOwnerProfiles", { userId: driver.userId });
    const types = await api.get("/document-types").set(auth(driver.token));
    const nationalId = types.body.data.find((t: { code: string }) => t.code === "NATIONAL_ID");
    const upload = await api
      .post(`/driver/verification/${nationalId.id}`)
      .set(auth(driver.token))
      .attach("file", Buffer.from("fake national id"), "national-id.jpg");
    expectStatus(upload, 201);
    const documentId = upload.body.data.id;
    const uploadedDriverId = upload.body.data.userId; // Use actual driver ID from response, not assumed
    trackForCleanup("verificationDocuments", { id: documentId });
    expectStatus(
      await api
        .patch(`/admin/verification/document/${documentId}`)
        .set(auth(superAdmin.token))
        .send({ status: "VERIFIED" }),
      200,
    );

    const [uploaded, reviewed, recalculated] = await Promise.all([
      findLogs({ action: "verification.document.upload", targetId: documentId }),
      findLogs({ action: "verification.document.review", targetId: documentId }),
      findLogs({ action: "verification.driver.recalculate", targetId: uploadedDriverId }), // Use actual driver ID
    ]);

    expect(uploaded.items[0]).toMatchObject({
      actorId: uploadedDriverId, // Use actual driver ID
      requestBody: { file: { originalName: "national-id.jpg", mimeType: "image/jpeg" } },
    });
    expect(uploaded.items[0].after).not.toHaveProperty("storageKey");
    expect(reviewed.items[0]).toMatchObject({
      actorId: superAdmin.userId,
      description: "Marked a verification document verified",
      before: { status: "PENDING" },
      after: { status: "VERIFIED", verifiedBy: superAdmin.userId },
    });
    expect(reviewed.items[0].changedFields).toEqual(
      expect.arrayContaining(["status", "verifiedAt", "verifiedBy"]),
    );
    // Never approved automatically: with its only document verified, the driver waits for an admin.
    // Find the recalculate entry from the review request (triggered by admin, not upload by driver)
    const reviewRecalculate = recalculated.items.find(
      (item: { actorId: string }) => item.actorId === superAdmin.userId,
    );
    expect(reviewRecalculate).toMatchObject({
      after: { verificationStatus: "pending" },
      changedFields: ["verificationStatus"],
    });
  });

  it("records sign-ins against the account, without the password or the tokens", async () => {
    const { items } = await findLogs({ action: "auth.login", actorId: auditor.userId });

    expect(items[0]).toMatchObject({
      module: "auth",
      result: "success",
      targetType: "user",
      targetId: auditor.userId,
      requestBody: { email: auditor.email, password: "[REDACTED]" },
      before: null,
      after: null,
    });
  });

  it("records a failed sign-in with the email that was tried", async () => {
    const email = await newEmail(data.person());
    expectStatus(await api.post("/auth/login").send({ email, password: data.password() }), 401);

    const { items } = await findLogs({ action: "auth.login", search: email });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actorId: null,
      actor: null,
      description: "Failed to sign in with email and password",
      targetId: null,
      result: "failure",
      errorMessage: "Invalid email or password",
      requestBody: { email, password: "[REDACTED]" },
    });
  });

  it("files a wrong password against the account it was tried on", async () => {
    expectStatus(
      await api
        .post("/auth/login")
        .send({ email: settingsManager.email, password: data.password() }),
      401,
    );

    const { items } = await findLogs({
      targetType: "user",
      targetId: settingsManager.userId,
      result: "failure",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "auth.login", actorId: null, result: "failure" });
  });
});

describe("GET /admin/activity-logs", () => {
  it("filters, pages newest first, and counts every match", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {
      settings: { create: true, read: true },
    });
    const firstKey = await newSettingKey();
    await createSetting(admin.token, firstKey);
    const secondKey = await newSettingKey();
    await createSetting(admin.token, secondKey);

    const firstPage = await findLogs({ actorId: admin.userId, module: "settings", limit: 1 });
    const byEmail = await findLogs({ search: admin.email, module: "settings" });

    expect(firstPage.stats).toEqual({ total: 2, success: 2, failure: 0, actors: 1 });
    expect(firstPage.pagination).toEqual({ page: 1, limit: 1, totalItems: 2, totalPages: 2 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].targetId).toBe(secondKey); // the latest comes first
    expect(byEmail.stats.total).toBe(2);
  });

  it("rejects a from that's after to", async () => {
    const res = await api
      .get("/admin/activity-logs")
      .query({ from: "2026-09-02T00:00:00Z", to: "2026-09-01T00:00:00Z" })
      .set(auth(auditor.token));

    expectStatus(res, 400);
    expect(res.body.error).toBe("to: from must not be after to");
  });

  it("needs activityLogs: read", async () => {
    const res = await api.get("/admin/activity-logs").set(auth(settingsManager.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on activityLogs");
  });
});

describe("GET /admin/activity-logs/:id", () => {
  it("returns one entry", async () => {
    const key = await newSettingKey();
    await createSetting(settingsManager.token, key);
    const { items } = await findLogs({ targetId: key });

    const res = await api.get(`/admin/activity-logs/${items[0].id}`).set(auth(auditor.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Activity log retrieved successfully");
    expect(res.body.data).toEqual(items[0]);
  });

  it("returns 404 for an unknown id", async () => {
    const id = "7c1e4b2a-9d3f-4e8a-b6c5-2f1a3d4e5b6c";

    const res = await api.get(`/admin/activity-logs/${id}`).set(auth(auditor.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Activity log not found: ${id}`);
  });
});

describe("GET /activity-logs/user/:userId", () => {
  it("returns activity logs for a user by user ID param", async () => {
    const rider = await signUpByPhone("rider");
    await flushActivityLogs();

    const res = await api.get(`/activity-logs/user/${rider.userId}`).set(auth(auditor.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("User activity logs retrieved successfully");
    const actions = res.body.data.items.map((item: { action: string }) => item.action);
    expect(actions).toContain("auth.signup");
  });

  it("needs activityLogs: read", async () => {
    const rider = await signUpByPhone("rider");
    const res = await api
      .get(`/activity-logs/user/${rider.userId}`)
      .set(auth(settingsManager.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on activityLogs");
  });
});
