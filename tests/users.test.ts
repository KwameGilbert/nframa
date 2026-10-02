import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createPhoneAccount,
  createRole,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
  superAdminRoleId,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newEmail, newPhone } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import db from "../src/database/knex.js";

type SignedInAdmin = Awaited<ReturnType<typeof createSignedInAdmin>>;

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let supportAgent: SignedInAdmin; // users: read
let userManager: SignedInAdmin; // full users access, nothing on roles
let accessManager: SignedInAdmin; // admin: read + delete, not a system role
let rider: Awaited<ReturnType<typeof signUpByPhone>>;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [supportAgent, userManager, accessManager, rider] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    createSignedInAdmin(superAdmin.token, {
      users: { create: true, read: true, update: true, delete: true },
    }),
    createSignedInAdmin(superAdmin.token, { admin: { read: true, delete: true } }),
    signUpByPhone("rider"),
  ]);
});

describe("GET /users", () => {
  it("lists riders and drivers, but not admins", async () => {
    const driver = await createPhoneAccount(userManager.token, "driver");

    const res = await api.get("/users").set(auth(userManager.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Users retrieved successfully");
    const found = res.body.data.find((u: { id: string }) => u.id === driver.id);
    expect(found).toMatchObject({ id: driver.id, role: "driver" });
    expect(res.body.data.some((u: { id: string }) => u.id === userManager.userId)).toBe(false);
  });

  it("needs users: read", async () => {
    const res = await api.get("/users").set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });
});

describe("POST /users", () => {
  it("adds a rider", async () => {
    const person = data.person();
    const phone = await newPhone();

    const res = await api
      .post("/users")
      .set(auth(userManager.token))
      .send({ fullName: person.fullName, ...phone, role: "rider" });

    expectStatus(res, 201);
    trackForCleanup("users", { id: res.body.data.id });
    expect(res.body.message).toBe("User created successfully");
    expect(res.body.data).toMatchObject({
      fullName: person.fullName,
      phoneCountryCode: phone.phoneCountryCode,
      phoneNumber: phone.phoneNumber,
      role: "rider",
      status: "active",
      deletedAt: null,
    });
    expect(res.body.data).not.toHaveProperty("passwordHash");
  });

  it("adds a driver", async () => {
    const res = await api
      .post("/users")
      .set(auth(userManager.token))
      .send({ fullName: data.person().fullName, ...(await newPhone()), role: "driver" });

    expectStatus(res, 201);
    trackForCleanup("users", { id: res.body.data.id });
    expect(res.body.data.role).toBe("driver");
  });

  it("adds an admin account, lowercasing the email", async () => {
    const person = data.person();
    const email = await newEmail(person);

    const res = await api
      .post("/users")
      .set(auth(superAdmin.token))
      .send({ fullName: person.fullName, email: email.toUpperCase(), role: "admin" });

    expectStatus(res, 201);
    trackForCleanup("users", { id: res.body.data.id });
    expect(res.body.data).toMatchObject({ email, role: "admin" });
  });

  it("needs a phone number for riders and drivers", async () => {
    const res = await api
      .post("/users")
      .set(auth(userManager.token))
      .send({ fullName: data.person().fullName, role: "rider" });

    expectStatus(res, 400);
    expect(res.body.error).toBe(
      "phoneNumber: Phone country code and phone number are required for rider/driver accounts",
    );
  });

  it("needs an email for admin accounts", async () => {
    const res = await api
      .post("/users")
      .set(auth(superAdmin.token))
      .send({ fullName: data.person().fullName, role: "admin" });

    expectStatus(res, 400);
    expect(res.body.error).toBe("email: email is required for admin accounts");
  });

  it("allows only one account per phone number", async () => {
    const existing = await createPhoneAccount(userManager.token, "rider");

    const res = await api.post("/users").set(auth(userManager.token)).send({
      fullName: data.person().fullName,
      phoneCountryCode: data.GHANA_COUNTRY_CODE,
      phoneNumber: existing.phoneNumber,
      role: "driver",
    });

    expectStatus(res, 409);
  });

  it("allows only one account per email, whatever its case", async () => {
    const person = data.person();
    const email = await newEmail(person);
    const create = (address: string) =>
      api
        .post("/users")
        .set(auth(superAdmin.token))
        .send({ fullName: person.fullName, email: address, role: "admin" });
    const created = await create(email);
    expectStatus(created, 201);
    trackForCleanup("users", { id: created.body.data.id });

    const res = await create(email.toUpperCase());

    expectStatus(res, 409);
  });

  it("needs users: create to add a rider", async () => {
    const res = await api
      .post("/users")
      .set(auth(supportAgent.token))
      .send({ fullName: data.person().fullName, ...(await newPhone()), role: "rider" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on users");
  });

  it("needs admin: create, not users: create, to add an admin account", async () => {
    const person = data.person();

    const res = await api
      .post("/users")
      .set(auth(userManager.token))
      .send({ fullName: person.fullName, email: data.email(person), role: "admin" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on admin");
  });

  it("doesn't let a rider add accounts", async () => {
    const res = await api
      .post("/users")
      .set(auth(rider.token))
      .send({ fullName: data.person().fullName, ...(await newPhone()), role: "rider" });

    expectStatus(res, 403);
  });

  it("needs a signed-in user", async () => {
    const res = await api.post("/users").send({ ...(await newPhone()), role: "rider" });

    expectStatus(res, 401);
  });
});

describe("GET /users/:id", () => {
  it("lets anyone read their own account", async () => {
    const res = await api.get(`/users/${rider.userId}`).set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("User retrieved successfully");
    expect(res.body.data).toMatchObject({ id: rider.userId, fullName: rider.fullName });
    expect(res.body.data.statusHistory).toEqual([]);
  });

  it("includes the user's emergency contacts, oldest first", async () => {
    const target = await signUpByPhone("rider");
    const contact = (name: string) => ({
      name,
      phoneCountryCode: data.GHANA_COUNTRY_CODE,
      phoneNumber: data.ghanaPhoneNumber(),
      relationship: "Sister",
    });
    for (const name of ["Ama Mensah", "Kofi Boateng"]) {
      const created = await api
        .post("/emergency-contacts")
        .set(auth(target.token))
        .send(contact(name));
      expectStatus(created, 201);
      trackForCleanup("emergencyContacts", { id: created.body.data.id });
    }

    const self = await api.get(`/users/${target.userId}`).set(auth(target.token));
    const admin = await api.get(`/users/${target.userId}`).set(auth(userManager.token));

    expectStatus(self, 200);
    expect(self.body.data.emergencyContacts).toHaveLength(2);
    expect(self.body.data.emergencyContacts.map((c: { name: string }) => c.name)).toEqual([
      "Ama Mensah",
      "Kofi Boateng",
    ]);
    expectStatus(admin, 200);
    expect(admin.body.data.emergencyContacts).toHaveLength(2);
  });

  it("returns an empty emergencyContacts list for a user with none", async () => {
    const res = await api.get(`/users/${rider.userId}`).set(auth(rider.token));

    expect(res.body.data.emergencyContacts).toEqual([]);
  });

  it("includes statusHistory; notes is null for a self-view but visible to an admin", async () => {
    const target = await signUpByPhone("rider");
    expectStatus(
      await api
        .patch(`/users/${target.userId}/status`)
        .set(auth(userManager.token))
        .send({ status: "suspended", reason: "Repeated cancellations", notes: "Internal note" }),
      200,
    );

    const self = await api.get(`/users/${target.userId}`).set(auth(target.token));
    const admin = await api.get(`/users/${target.userId}`).set(auth(userManager.token));

    expectStatus(self, 200);
    expect(self.body.data.statusHistory).toHaveLength(1);
    expect(self.body.data.statusHistory[0]).toMatchObject({
      reason: "Repeated cancellations",
      notes: null,
    });

    expectStatus(admin, 200);
    expect(admin.body.data.statusHistory[0]).toMatchObject({
      reason: "Repeated cancellations",
      notes: "Internal note",
    });
  });

  it("doesn't let a rider read someone else's account", async () => {
    const other = await createPhoneAccount(userManager.token, "rider");

    const res = await api.get(`/users/${other.id}`).set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });

  it("lets an admin with users: read view riders", async () => {
    const res = await api.get(`/users/${rider.userId}`).set(auth(supportAgent.token));

    expectStatus(res, 200);
  });

  it("needs admin: read to view an admin account", async () => {
    const res = await api.get(`/users/${userManager.userId}`).set(auth(supportAgent.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on admin");
  });

  it("returns 404 for an unknown id", async () => {
    const id = "5b3f0c1e-8d2a-4f6b-9c7e-1a2b3c4d5e6f";

    const res = await api.get(`/users/${id}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`User not found: ${id}`);
  });

  it("returns 400 for an id that isn't a UUID", async () => {
    const res = await api.get("/users/kofi-mensah").set(auth(superAdmin.token));

    expectStatus(res, 400);
  });
});

describe("PATCH /users/:id", () => {
  it("lets a rider update their own name and date of birth", async () => {
    const self = await signUpByPhone("rider");
    const { fullName } = data.person();

    const res = await api
      .patch(`/users/${self.userId}`)
      .set(auth(self.token))
      .send({ fullName, dateOfBirth: "1994-03-06" });

    expectStatus(res, 200);
    expect(res.body.message).toBe("User updated successfully");
    expect(res.body.data).toMatchObject({ fullName, dateOfBirth: "1994-03-06" });
  });

  it("lets a rider change their phone number, which then needs verifying again", async () => {
    const self = await signUpByPhone("rider");
    const { phoneNumber } = await newPhone();

    const res = await api
      .patch(`/users/${self.userId}`)
      .set(auth(self.token))
      .send({ phoneNumber });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ phoneNumber, isPhoneVerified: false });
  });

  it("lets a rider add and change their email, which starts unverified", async () => {
    const self = await signUpByPhone("rider");

    const first = await api
      .patch(`/users/${self.userId}`)
      .set(auth(self.token))
      .send({ email: await newEmail(data.person()) });
    const email = await newEmail(data.person());
    const second = await api.patch(`/users/${self.userId}`).set(auth(self.token)).send({ email });

    expectStatus(first, 200);
    expect(first.body.data.isEmailVerified).toBe(false);
    expectStatus(second, 200);
    expect(second.body.data).toMatchObject({ email, isEmailVerified: false });
  });

  it("treats resending the current phone number and email as no change", async () => {
    const self = await signUpByPhone("rider");
    const email = await newEmail(data.person());
    await db("users").where({ id: self.userId }).update({ email, isEmailVerified: true });
    const { fullName } = data.person();

    const res = await api.patch(`/users/${self.userId}`).set(auth(self.token)).send({
      fullName,
      email,
      phoneCountryCode: self.phoneCountryCode,
      phoneNumber: self.phoneNumber,
    });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      fullName,
      email,
      isEmailVerified: true,
      isPhoneVerified: true,
    });
  });

  it("finds your own account whatever the case of the id in the path", async () => {
    const self = await signUpByPhone("rider");

    const res = await api
      .patch(`/users/${self.userId.toUpperCase()}`)
      .set(auth(self.token))
      .send({ fullName: data.person().fullName });

    expectStatus(res, 200);
  });

  it("lets an admin with users: update change a rider's phone number", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");
    const { phoneNumber } = await newPhone();

    const res = await api
      .patch(`/users/${target.id}`)
      .set(auth(userManager.token))
      .send({ phoneNumber });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ phoneNumber, isPhoneVerified: false });
  });

  it("won't give an account a phone number that's already taken", async () => {
    const [target, holder] = await Promise.all([
      createPhoneAccount(userManager.token, "rider"),
      createPhoneAccount(userManager.token, "driver"),
    ]);

    const res = await api
      .patch(`/users/${target.id}`)
      .set(auth(userManager.token))
      .send({ phoneNumber: holder.phoneNumber });

    expectStatus(res, 409);
  });

  it("doesn't let a rider update someone else", async () => {
    const other = await createPhoneAccount(userManager.token, "rider");

    const res = await api
      .patch(`/users/${other.id}`)
      .set(auth(rider.token))
      .send({ fullName: data.person().fullName });

    expectStatus(res, 403);
  });

  it("needs admin: update, not users: update, to edit an admin account", async () => {
    const role = await createRole(superAdmin.token);
    const target = await createAdminAccount(superAdmin.token, {
      roleId: role.id,
      status: "invited",
    });

    const res = await api
      .patch(`/users/${target.userId}`)
      .set(auth(userManager.token))
      .send({ fullName: data.person().fullName });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on admin");
  });

  it("rejects an empty update", async () => {
    const res = await api.patch(`/users/${rider.userId}`).set(auth(rider.token)).send({});

    expectStatus(res, 400);
    expect(res.body.error).toBe("At least one field must be provided");
  });

  it("saves personal and driver-specific fields together in one call", async () => {
    const target = await createPhoneAccount(userManager.token, "driver");
    expectStatus(
      await api.post("/driver").set(auth(userManager.token)).send({ userId: target.id }),
      201,
    );
    trackForCleanup("carOwnerProfiles", { userId: target.id });
    const { fullName } = data.person();

    const res = await api
      .patch(`/users/${target.id}`)
      .set(auth(userManager.token))
      .send({
        fullName,
        profile: { ghanaCardNumber: "GHA-555555555-0", isOnline: true },
      });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ fullName });
    expect(res.body.data).not.toHaveProperty("profile");

    const driver = await api.get(`/driver/${target.id}`).set(auth(userManager.token));
    expectStatus(driver, 200);
    expect(driver.body.data.driver).toMatchObject({
      ghanaCardNumber: "GHA-555555555-0",
      isOnline: true,
      user: { fullName },
    });
  });

  it("rejects profile for a non-driver account", async () => {
    const res = await api
      .patch(`/users/${rider.userId}`)
      .set(auth(rider.token))
      .send({ profile: { isOnline: true } });

    expectStatus(res, 400);
    expect(res.body.error).toBe("profile can only be set for driver accounts");
  });

  it("rejects profile for a driver that hasn't created one yet", async () => {
    const target = await createPhoneAccount(userManager.token, "driver");

    const res = await api
      .patch(`/users/${target.id}`)
      .set(auth(userManager.token))
      .send({ profile: { isOnline: true } });

    expectStatus(res, 400);
    expect(res.body.error).toBe(
      "This driver has no profile yet — create one first via POST /driver",
    );
  });
});

describe("PATCH /users/:id/status", () => {
  it("suspends a rider, blocking further sign-in", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");

    const res = await api
      .patch(`/users/${target.id}/status`)
      .set(auth(userManager.token))
      .send({ status: "suspended" });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Account suspended successfully");
    expect(res.body.data.status).toBe("suspended");
    const otp = await api.post("/auth/login/otp").send({
      phoneCountryCode: data.GHANA_COUNTRY_CODE,
      phoneNumber: target.phoneNumber,
    });
    expectStatus(otp, 403);
    expect(otp.body.error).toBe("Account is not active");
  });

  it("reactivates a suspended account", async () => {
    const target = await createPhoneAccount(userManager.token, "driver");
    expectStatus(
      await api
        .patch(`/users/${target.id}/status`)
        .set(auth(userManager.token))
        .send({ status: "suspended" }),
      200,
    );

    const res = await api
      .patch(`/users/${target.id}/status`)
      .set(auth(userManager.token))
      .send({ status: "active" });

    expectStatus(res, 200);
    expect(res.body.data.status).toBe("active");
  });

  it("returns 409 for a status the account already has", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");

    const res = await api
      .patch(`/users/${target.id}/status`)
      .set(auth(userManager.token))
      .send({ status: "active" });

    expectStatus(res, 409);
    expect(res.body.error).toBe("Account is already active");
  });

  it("doesn't let a rider change someone else's status", async () => {
    const other = await createPhoneAccount(userManager.token, "rider");

    const res = await api
      .patch(`/users/${other.id}/status`)
      .set(auth(rider.token))
      .send({ status: "suspended" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on users");
  });

  it("doesn't let anyone change their own status", async () => {
    const res = await api
      .patch(`/users/${userManager.userId}/status`)
      .set(auth(userManager.token))
      .send({ status: "suspended" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("You can't change your own account status");
  });

  it("needs admin: update, not users: update, to change an admin's status", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });
    const target = await createAdminAccount(superAdmin.token, { roleId: role.id });

    const res = await api
      .patch(`/users/${target.userId}/status`)
      .set(auth(userManager.token))
      .send({ status: "suspended" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on admin");
  });

  it("records the reason and notes on a status history entry, not on the user record", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");

    const res = await api.patch(`/users/${target.id}/status`).set(auth(userManager.token)).send({
      status: "suspended",
      reason: "Repeated ride cancellations",
      notes: "Third warning this month, see ticket #482",
    });

    expectStatus(res, 200);
    expect(res.body.data).not.toHaveProperty("reason");
    expect(res.body.data).not.toHaveProperty("notes");

    const history = await api
      .get(`/users/${target.id}/status-history`)
      .set(auth(userManager.token));

    expectStatus(history, 200);
    expect(history.body.data[0]).toMatchObject({
      userId: target.id,
      previousStatus: "active",
      newStatus: "suspended",
      reason: "Repeated ride cancellations",
      notes: "Third warning this month, see ticket #482",
      changedBy: userManager.userId,
    });
  });
});

describe("GET /users/:id/status-history", () => {
  it("lists every status transition, newest first", async () => {
    const target = await createPhoneAccount(userManager.token, "driver");
    await api
      .patch(`/users/${target.id}/status`)
      .set(auth(userManager.token))
      .send({ status: "suspended", reason: "Fraud investigation" });
    await api
      .patch(`/users/${target.id}/status`)
      .set(auth(userManager.token))
      .send({ status: "active" });

    const res = await api.get(`/users/${target.id}/status-history`).set(auth(userManager.token));

    expectStatus(res, 200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ previousStatus: "suspended", newStatus: "active" });
    expect(res.body.data[1]).toMatchObject({
      previousStatus: "active",
      newStatus: "suspended",
      reason: "Fraud investigation",
    });
  });

  it("needs users: read — not visible to the account holder themselves", async () => {
    const target = await signUpByPhone("rider");

    const res = await api.get(`/users/${target.userId}/status-history`).set(auth(target.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });
});

describe("GET /users/:id/activity-logs", () => {
  it("combines what the account did and what was done to it, newest first", async () => {
    const target = await signUpByPhone("driver"); // actor: the account itself (auth.signup, user.update)
    expectStatus(
      await api
        .patch(`/users/${target.userId}/status`)
        .set(auth(userManager.token))
        .send({ status: "suspended", reason: "Test" }), // actor: userManager, target: the account
      200,
    );
    await flushActivityLogs();

    const res = await api.get(`/users/${target.userId}/activity-logs`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    const actions = res.body.data.items.map((item: { action: string }) => item.action);
    expect(actions).toContain("auth.signup"); // as actor
    expect(actions).toContain("user.suspend"); // as target, by a different account
    expect(res.body.data.items[0].action).toBe("user.suspend");
  });

  it("needs activityLogs: read — users: read alone isn't enough", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");

    const res = await api.get(`/users/${target.id}/activity-logs`).set(auth(supportAgent.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on activityLogs");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await api
      .get("/users/7c1e4b2a-9d3f-4e8a-b6c5-2f1a3d4e5b6c/activity-logs")
      .set(auth(superAdmin.token));

    expectStatus(res, 404);
  });
});

describe("DELETE /users/:id", () => {
  it("lets a rider delete their own account, keeping the record (soft delete)", async () => {
    const self = await signUpByPhone("rider");

    const res = await api.delete(`/users/${self.userId}`).set(auth(self.token));

    expectStatus(res, 200);
    expect(res.body).toEqual({ success: true, message: "User deleted successfully", data: null });
    const after = await api.get(`/users/${self.userId}`).set(auth(superAdmin.token));
    expectStatus(after, 200);
    expect(after.body.data.deletedAt).not.toBeNull();
  });

  it("returns 409 for an account that's already deleted", async () => {
    const target = await createPhoneAccount(userManager.token, "driver");
    expectStatus(await api.delete(`/users/${target.id}`).set(auth(userManager.token)), 200);

    const res = await api.delete(`/users/${target.id}`).set(auth(userManager.token));

    expectStatus(res, 409);
    expect(res.body.error).toBe("User is already deleted");
  });

  it("doesn't let a rider delete someone else", async () => {
    const other = await createPhoneAccount(userManager.token, "rider");

    const res = await api.delete(`/users/${other.id}`).set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on users");
  });

  it("lets an admin with users: delete delete a rider", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");

    const res = await api.delete(`/users/${target.id}`).set(auth(userManager.token));

    expectStatus(res, 200);
  });

  it("needs admin: delete, not users: delete, to delete an admin account", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });
    const target = await createAdminAccount(superAdmin.token, { roleId: role.id });

    const res = await api.delete(`/users/${target.userId}`).set(auth(userManager.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on admin");
  });

  it("doesn't let an admin delete their own account", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {
      admin: { read: true, delete: true },
    });

    const res = await api.delete(`/users/${admin.userId}`).set(auth(admin.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("You can't delete your own admin account");
  });

  it("only lets a system-role admin delete a system-role admin", async () => {
    // Invited, so this super admin account can never sign in.
    const target = await createAdminAccount(superAdmin.token, {
      roleId: await superAdminRoleId(superAdmin.token),
      status: "invited",
    });

    const refused = await api.delete(`/users/${target.userId}`).set(auth(accessManager.token));
    const allowed = await api.delete(`/users/${target.userId}`).set(auth(superAdmin.token));

    expectStatus(refused, 403);
    expect(refused.body.error).toBe("Only an admin with a system role can delete a Super Admin");
    expectStatus(allowed, 200);
  });
});
