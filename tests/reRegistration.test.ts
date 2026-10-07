import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { captureCode, wrongCode } from "./helpers/outbox.js";
import {
  fullPhone,
  loginAsSuperAdmin,
  signUpByPhone,
  signUpDriverWithProfile,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newEmail, newPhone, newVehicle } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { seedCategory, seedTicket } from "./helpers/support.js";
import { postVehicle } from "./helpers/vehicles.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { hashPassword } from "../src/utils/password.js";
import { userModel } from "../src/models/user.model.js";
import { walletModel } from "../src/models/wallet.model.js";
import db from "../src/database/knex.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let documentTypeId: number;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  const types = await api.get("/document-types").set(auth(superAdmin.token));
  expectStatus(types, 200);
  documentTypeId = types.body.data[0].id;
});

type Phone = { phoneCountryCode: string; phoneNumber: string };

function phoneOf(account: Phone): Phone {
  return { phoneCountryCode: account.phoneCountryCode, phoneNumber: account.phoneNumber };
}

// A signed-up rider (with a name) that the super admin then deletes.
async function deletedRider() {
  const rider = await signUpByPhone("rider");
  expectStatus(await api.delete(`/users/${rider.userId}`).set(auth(superAdmin.token)), 200);
  return rider;
}

// Gives the account an email and a password, so it can be tried with POST /auth/login.
async function withEmailAndPassword(userId: string) {
  const email = await newEmail(data.person());
  const password = data.password();
  expectStatus(
    await api.patch(`/users/${userId}`).set(auth(superAdmin.token)).send({ email }),
    200,
  );
  await db("users")
    .where({ id: userId })
    .update({ passwordHash: await hashPassword(password) });
  return { email, password };
}

function requestCode(phone: Phone, role?: "rider" | "driver") {
  return captureCode(fullPhone(phone), async () => {
    const res = await api.post("/auth/login/otp").send({ ...phone, role });
    expectStatus(res, 200);
  });
}

function verify(phone: Phone, code: string, role?: "rider" | "driver") {
  return api.post("/auth/login/verify").send({ ...phone, role, code });
}

async function findLogs(query: Record<string, string>) {
  await flushActivityLogs();
  const res = await api.get("/admin/activity-logs").query(query).set(auth(superAdmin.token));
  expectStatus(res, 200);
  return res.body.data.items;
}

describe("Re-registering a deleted account by phone", () => {
  it("reactivates a rider as a driver (no driver profile) with a clean account", async () => {
    const rider = await signUpByPhone("rider");
    const phone = phoneOf(rider);
    const { email, password } = await withEmailAndPassword(rider.userId);
    expectStatus(
      await api
        .patch(`/users/${rider.userId}`)
        .set(auth(rider.token))
        .send({
          dateOfBirth: "1995-04-12",
          profilePicture: `https://cdn.nframa.com/avatars/${rider.userId}.jpg`,
        }),
      200,
    );
    expectStatus(await api.delete(`/users/${rider.userId}`).set(auth(superAdmin.token)), 200);
    // A session the delete somehow missed: reactivating must not bring it back to life.
    await db("authSessions").where({ userId: rider.userId }).update({ revokedAt: null });

    const code = await requestCode(phone, "driver");
    const res = await verify(phone, code, "driver");

    expectStatus(res, 200);
    expect(res.body.data.isNewUser).toBe(true);
    expect(res.body.data.user).toMatchObject({
      id: rider.userId,
      role: "driver",
      status: "active",
      deletedAt: null,
      fullName: null,
      email: null,
      dateOfBirth: null,
      profilePicture: null,
      isPhoneVerified: true,
      isEmailVerified: false,
      isProfileComplete: false,
      profile: null,
      ...phone,
    });
    const me = await api.get("/auth/me").set(auth(res.body.data.accessToken));
    expectStatus(me, 200);
    expect(me.body.data).toMatchObject({ id: rider.userId, role: "driver", deletedAt: null });

    const oldRefresh = await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken });
    expectStatus(oldRefresh, 401);
    const oldPassword = await api.post("/auth/login").send({ email, password });
    expectStatus(oldPassword, 401);
    expect(oldPassword.body.error).toBe("Invalid email or password");
    const row = await db("users").where({ id: rider.userId }).first();
    expect(row).toMatchObject({ passwordHash: null, passwordSalt: null, deletedAt: null });

    const [signup] = await findLogs({ action: "auth.signup", targetId: rider.userId });
    expect(signup).toMatchObject({
      actorId: rider.userId,
      description: "Re-registered a deleted account as a driver with a verification code",
      before: { id: rider.userId, role: "rider", email, fullName: rider.fullName },
      after: { id: rider.userId, role: "driver", email: null, fullName: null, deletedAt: null },
    });
    expect(signup.before.deletedAt).not.toBeNull();
    expect(signup.changedFields).toEqual(
      expect.arrayContaining(["role", "email", "fullName", "deletedAt"]),
    );
    const requests = await findLogs({ action: "auth.otp.request", targetId: rider.userId });
    expect(requests.length).toBeGreaterThan(0);
  });

  it("resets a driver's profile, documents, commutes and vehicles, and keeps the wallet", async () => {
    const driver = await signUpDriverWithProfile();
    const phone = phoneOf(driver);
    trackForCleanup("verificationDocuments", { userId: driver.userId });
    trackForCleanup("transactions", { userId: driver.userId });
    trackForCleanup("wallets", { userId: driver.userId });
    const document = await api
      .post(`/driver/verification/${documentTypeId}`)
      .set(auth(driver.token))
      .attach("file", Buffer.from("fake national id"), "national-id.jpg");
    expectStatus(document, 201);
    const commute = await api.post("/commutes").set(auth(driver.token)).send(data.commute());
    expectStatus(commute, 201);
    trackForCleanup("driverCommutes", { id: commute.body.data.id });
    const vehicle = await postVehicle(driver.token, await newVehicle(driver.userId));
    expectStatus(vehicle, 201);
    trackForCleanup("vehicles", { id: vehicle.body.data.id });
    // Approval through the API needs every required document verified; this driver's own row is set directly.
    await db("carOwnerProfiles").where({ userId: driver.userId }).update({
      verificationStatus: "approved",
      termsAcceptedAt: new Date(),
      isOnline: true,
      autoAcceptBookings: true,
    });
    await walletModel.record({
      userId: driver.userId,
      type: "topup",
      direction: "credit",
      amount: 75.5,
    });
    expectStatus(await api.delete(`/users/${driver.userId}`).set(auth(superAdmin.token)), 200);

    const code = await requestCode(phone, "driver");
    const res = await verify(phone, code, "driver");

    expectStatus(res, 200);
    expect(res.body.data.isNewUser).toBe(true);
    expect(res.body.data.user.profile).toMatchObject({
      userId: driver.userId,
      verificationStatus: "unverified",
      ghanaCardNumber: null,
      address: null,
      termsAcceptedAt: null,
      isOnline: false,
      autoAcceptBookings: false,
    });
    const token = res.body.data.accessToken;
    const documents = await api.get("/driver/verification").set(auth(token));
    expectStatus(documents, 200);
    expect(documents.body.data).toEqual([]);
    // Reviewing the old document now changes nothing: it no longer counts towards an approval.
    expectStatus(
      await api
        .patch(`/admin/verification/document/${document.body.data.id}`)
        .set(auth(superAdmin.token))
        .send({ status: "VERIFIED" }),
      200,
    );
    const profile = await db("carOwnerProfiles").where({ userId: driver.userId }).first();
    expect(profile.verificationStatus).toBe("unverified");
    const commutes = await api.get("/commutes").set(auth(token));
    expectStatus(commutes, 200);
    expect(commutes.body.data).toEqual([
      expect.objectContaining({ id: commute.body.data.id, isActive: false }),
    ]);
    const car = await api.get(`/vehicles/${vehicle.body.data.id}`).set(auth(superAdmin.token));
    expectStatus(car, 200);
    expect(car.body.data).toMatchObject({ status: "retired", isVerified: false });
    const wallet = await api.get("/wallet").set(auth(token));
    expectStatus(wallet, 200);
    expect(wallet.body.data).toMatchObject({ balance: 75.5, heldAmount: 0 });
  });

  it("proves the suspension check before the code is used: a suspended account stays deleted", async () => {
    const rider = await deletedRider();
    const phone = phoneOf(rider);
    const code = await requestCode(phone, "rider");
    expectStatus(
      await api
        .patch(`/users/${rider.userId}/status`)
        .set(auth(superAdmin.token))
        .send({ status: "suspended", reason: "Repeated ride cancellations" }),
      200,
    );

    const res = await verify(phone, code, "rider");
    const again = await api.post("/auth/login/otp").send({ ...phone, role: "rider" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Account is not active");
    expectStatus(again, 403);
    expect(again.body.error).toBe("Account is not active");
    const row = await db("users").where({ id: rider.userId }).first();
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe("suspended");
  });

  // A suspension (or an admin row) that reaches reactivate itself, e.g. suspended after the check above: the
  // conditional UPDATE matches nothing, so nothing is reactivated.
  it("reactivate() itself refuses a suspended or admin row", async () => {
    const rider = await deletedRider();
    await db("users").where({ id: rider.userId }).update({ status: "suspended" });
    const admin = await deletedRider();
    await db("users").where({ id: admin.userId }).update({ role: "admin" });

    const results = await Promise.all([
      userModel.reactivate(rider.userId, "rider"),
      userModel.reactivate(admin.userId, "driver"),
    ]);

    expect(results).toEqual([undefined, undefined]);
    const rows = await db("users").whereIn("id", [rider.userId, admin.userId]);
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
    expect(rows.find((row) => row.id === admin.userId).role).toBe("admin");
  });

  it("never reactivates a deleted admin account, even one with a phone number", async () => {
    const phone = await newPhone();
    const created = await api
      .post("/users")
      .set(auth(superAdmin.token))
      .send({
        fullName: data.person().fullName,
        email: await newEmail(data.person()),
        ...phone,
        role: "admin",
      });
    expectStatus(created, 201);
    trackForCleanup("users", { id: created.body.data.id });
    expectStatus(
      await api.delete(`/users/${created.body.data.id}`).set(auth(superAdmin.token)),
      200,
    );

    const res = await api.post("/auth/login/otp").send({ ...phone, role: "rider" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Account is not active");
    const row = await db("users").where({ id: created.body.data.id }).first();
    expect(row).toMatchObject({ role: "admin" });
    expect(row.deletedAt).not.toBeNull();
  });

  it("still refuses a deleted account's password, email code and old refresh token", async () => {
    const rider = await signUpByPhone("rider");
    const { email, password } = await withEmailAndPassword(rider.userId);
    expectStatus(await api.delete(`/users/${rider.userId}`).set(auth(superAdmin.token)), 200);

    const login = await api.post("/auth/login").send({ email, password });
    const emailCode = await api.post("/auth/login/otp").send({ email });
    const refresh = await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken });

    expectStatus(login, 403);
    expect(login.body.error).toBe("Account is not active");
    expectStatus(emailCode, 403);
    expect(emailCode.body.error).toBe("Account is not active");
    expectStatus(refresh, 401);
    const row = await db("users").where({ id: rider.userId }).first();
    expect(row.deletedAt).not.toBeNull();
  });

  it("needs a role, like a new number", async () => {
    const rider = await deletedRider();
    const phone = phoneOf(rider);

    const otp = await api.post("/auth/login/otp").send(phone);
    const code = await requestCode(phone, "rider");
    const res = await verify(phone, code);

    expectStatus(otp, 400);
    expect(otp.body.error).toBe("role is required to sign up");
    expectStatus(res, 400);
    expect(res.body.error).toBe("role is required to sign up");
    const row = await db("users").where({ id: rider.userId }).first();
    expect(row.deletedAt).not.toBeNull();
  });

  it("doesn't reactivate on a wrong code", async () => {
    const rider = await deletedRider();
    const phone = phoneOf(rider);
    const code = await requestCode(phone, "rider");

    const res = await verify(phone, wrongCode(code), "rider");

    expectStatus(res, 400);
    expect(res.body.error).toBe("Invalid verification code");
    const row = await db("users").where({ id: rider.userId }).first();
    expect(row).toMatchObject({ role: "rider", fullName: rider.fullName });
    expect(row.deletedAt).not.toBeNull();
  });

  it("reactivates once when the same code is verified twice at the same time", async () => {
    const rider = await deletedRider();
    const phone = phoneOf(rider);
    const code = await requestCode(phone, "driver");

    const results = await Promise.all([
      verify(phone, code, "driver"),
      verify(phone, code, "driver"),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    const loser = results.find((res) => res.status === 400);
    expect(loser?.body.error).toBe("No pending verification code for this identifier");
    const row = await db("users").where({ id: rider.userId }).first();
    expect(row).toMatchObject({ role: "driver", deletedAt: null });
    const signups = await findLogs({ action: "auth.signup", targetId: rider.userId });
    expect(signups).toHaveLength(2); // the original sign-up and one re-registration
  });

  it("hides the old owner's support tickets from the number's new owner, and closes them", async () => {
    const rider = await deletedRider();
    const category = await seedCategory();
    const ticket = await seedTicket(rider.userId, category.id, { status: "inProgress" });

    const phone = phoneOf(rider);
    const res = await verify(phone, await requestCode(phone, "rider"), "rider");
    expectStatus(res, 200);
    const token = res.body.data.accessToken;

    const mine = await api.get("/support/tickets").set(auth(token));
    expectStatus(mine, 200);
    expect(mine.body.data.items).toEqual([]);
    expectStatus(await api.get(`/support/tickets/${ticket.id}`).set(auth(token)), 404);
    const row = await db("supportTickets").where({ id: ticket.id }).first();
    expect(row).toMatchObject({ status: "closed", userId: rider.userId });
    expect(row.detachedAt).not.toBeNull();
    expect(row.closedAt).not.toBeNull();
  });
});
