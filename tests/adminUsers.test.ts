import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createPhoneAccount,
  createRole,
  createSignedInAdmin,
  login,
  loginAsSuperAdmin,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newEmail } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let roleId: string;

// A user with role admin but no admin record yet — the state POST /admin expects.
async function newAdminUser() {
  const person = data.person();
  const res = await api
    .post("/users")
    .set(auth(superAdmin.token))
    .send({ fullName: person.fullName, email: await newEmail(person), role: "admin" });
  expectStatus(res, 201);
  trackForCleanup("users", { id: res.body.data.id });
  return res.body.data as { id: string; email: string };
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  roleId = (await createRole(superAdmin.token, { users: { read: true } })).id;
});

describe("POST /admin", () => {
  it("creates the admin record as invited", async () => {
    const user = await newAdminUser();
    const department = data.department();

    const res = await api
      .post("/admin")
      .set(auth(superAdmin.token))
      .send({ userId: user.id, roleId, department, password: data.password() });

    expectStatus(res, 201);
    trackForCleanup("adminUsers", { userId: user.id });
    expect(res.body.message).toBe("Admin user created successfully");
    expect(res.body.data).toMatchObject({ userId: user.id, roleId, department, status: "invited" });
  });

  it("allows one admin record per user", async () => {
    const admin = await createAdminAccount(superAdmin.token, { roleId, status: "invited" });

    const res = await api
      .post("/admin")
      .set(auth(superAdmin.token))
      .send({ userId: admin.userId, roleId });

    expectStatus(res, 409);
  });

  it("rejects a role that doesn't exist", async () => {
    const user = await newAdminUser();

    const res = await api
      .post("/admin")
      .set(auth(superAdmin.token))
      .send({ userId: user.id, roleId: "0b9d6f3a-2c4e-4a8b-9f1d-7e6c5b4a3f2e" });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Referenced record does not exist");
  });

  it("won't give a rider or driver an admin record", async () => {
    const [rider, driver] = await Promise.all([
      createPhoneAccount(superAdmin.token, "rider"),
      createPhoneAccount(superAdmin.token, "driver"),
    ]);

    for (const [account, role] of [
      [rider, "rider"],
      [driver, "driver"],
    ] as const) {
      const res = await api
        .post("/admin")
        .set(auth(superAdmin.token))
        .send({ userId: account.id, roleId, password: data.password() });

      expectStatus(res, 400);
      expect(res.body.error).toBe(
        `User ${account.id} is a ${role}; only accounts with role admin can have an admin record`,
      );
      expectStatus(await api.get(`/admin/${account.id}`).set(auth(superAdmin.token)), 404);
    }
  });

  it("rejects a user that doesn't exist", async () => {
    const userId = "2f7a9c4e-6b1d-4e8a-9c3f-5d7b1a2e4c6f";

    const res = await api.post("/admin").set(auth(superAdmin.token)).send({ userId, roleId });

    expectStatus(res, 400);
    expect(res.body.error).toBe(`User not found: ${userId}`);
  });

  it("rejects a deleted admin account", async () => {
    const user = await newAdminUser();
    expectStatus(await api.delete(`/users/${user.id}`).set(auth(superAdmin.token)), 200);

    const res = await api
      .post("/admin")
      .set(auth(superAdmin.token))
      .send({ userId: user.id, roleId });

    expectStatus(res, 400);
    expect(res.body.error).toBe(`User not found: ${user.id}`);
  });

  it("needs roles: create", async () => {
    const [user, userManager] = await Promise.all([
      newAdminUser(),
      createSignedInAdmin(superAdmin.token, { users: { create: true, read: true } }),
    ]);

    const res = await api
      .post("/admin")
      .set(auth(userManager.token))
      .send({ userId: user.id, roleId });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on roles");
  });
});

describe("Activating an admin", () => {
  it("an invited admin can sign in once their status is set to active", async () => {
    const admin = await createAdminAccount(superAdmin.token, { roleId, status: "invited" });
    const signIn = () =>
      api.post("/auth/login").send({ email: admin.email, password: admin.password });
    expectStatus(await signIn(), 403);

    const res = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ status: "active" });

    expectStatus(res, 200);
    expect(res.body.data.status).toBe("active");
    expectStatus(await signIn(), 200);
  });
});

describe("GET /admin/:userId", () => {
  it("returns the admin record", async () => {
    const admin = await createAdminAccount(superAdmin.token, { roleId, status: "invited" });

    const res = await api.get(`/admin/${admin.userId}`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Admin user retrieved successfully");
    expect(res.body.data).toMatchObject({ userId: admin.userId, roleId, status: "invited" });
  });

  it("returns 404 for a user without an admin record", async () => {
    const rider = await createPhoneAccount(superAdmin.token, "rider");

    const res = await api.get(`/admin/${rider.id}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Admin user not found for user: ${rider.id}`);
  });

  it("needs roles: read", async () => {
    const supportAgent = await createSignedInAdmin(superAdmin.token, { users: { read: true } });

    const res = await api.get(`/admin/${supportAgent.userId}`).set(auth(supportAgent.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on roles");
  });
});

describe("PATCH /admin/:userId", () => {
  it("changes an admin's department", async () => {
    const admin = await createAdminAccount(superAdmin.token, { roleId, status: "invited" });

    const res = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ department: "Safety" });

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      message: "Admin user updated successfully",
      data: { department: "Safety" },
    });
  });

  it("moves an admin to another role", async () => {
    const [admin, newRole] = await Promise.all([
      createAdminAccount(superAdmin.token, { roleId, status: "invited" }),
      createRole(superAdmin.token, { settings: { read: true } }),
    ]);

    const res = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ roleId: newRole.id });

    expectStatus(res, 200);
    expect(res.body.data.roleId).toBe(newRole.id);
  });

  it("cuts off a suspended admin on their very next request", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, { roles: { read: true } });
    expectStatus(await api.get("/roles").set(auth(admin.token)), 200);

    const res = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ status: "suspended" });

    expectStatus(res, 200);
    expectStatus(await api.get("/roles").set(auth(admin.token)), 403);
    const signIn = await api
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password });
    expectStatus(signIn, 403);
  });

  it("doesn't let admins change their own role or status", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {
      roles: { read: true, update: true },
    });

    const status = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(admin.token))
      .send({ status: "suspended" });
    const role = await api.patch(`/admin/${admin.userId}`).set(auth(admin.token)).send({ roleId });

    expectStatus(status, 403);
    expect(status.body.error).toBe("You can't change your own role or status");
    expectStatus(role, 403);
  });

  it("lets admins change their own department", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {
      roles: { read: true, update: true },
    });

    const res = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(admin.token))
      .send({ department: "Customer Support" });

    expectStatus(res, 200);
  });

  it("needs roles: update", async () => {
    const [target, viewer] = await Promise.all([
      createAdminAccount(superAdmin.token, { roleId, status: "invited" }),
      createSignedInAdmin(superAdmin.token, { roles: { read: true } }),
    ]);

    const res = await api
      .patch(`/admin/${target.userId}`)
      .set(auth(viewer.token))
      .send({ department: "Finance" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on roles");
  });

  it("returns 404 for a user without an admin record", async () => {
    const rider = await createPhoneAccount(superAdmin.token, "rider");

    const res = await api
      .patch(`/admin/${rider.id}`)
      .set(auth(superAdmin.token))
      .send({ department: "Operations" });

    expectStatus(res, 404);
  });
});

describe("DELETE /admin/:userId", () => {
  it("soft-deletes the admin's account so they can't sign in", async () => {
    const admin = await createAdminAccount(superAdmin.token, { roleId });

    const res = await api.delete(`/admin/${admin.userId}`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Admin user deleted successfully");
    expect(res.body.data).toMatchObject({ userId: admin.userId, roleId });
    const signIn = await api
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password });
    expectStatus(signIn, 403);
    expect(signIn.body.error).toBe("Account is not active");
  });

  it("returns 409 for an admin who's already deleted", async () => {
    const admin = await createAdminAccount(superAdmin.token, { roleId, status: "invited" });
    expectStatus(await api.delete(`/admin/${admin.userId}`).set(auth(superAdmin.token)), 200);

    const res = await api.delete(`/admin/${admin.userId}`).set(auth(superAdmin.token));

    expectStatus(res, 409);
  });

  it("doesn't let admins delete themselves", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {
      roles: { read: true, delete: true },
    });

    const res = await api.delete(`/admin/${admin.userId}`).set(auth(admin.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("You can't delete your own admin account");
  });

  it("needs roles: delete", async () => {
    const [target, caller] = await Promise.all([
      createAdminAccount(superAdmin.token, { roleId, status: "invited" }),
      createSignedInAdmin(superAdmin.token, { roles: { read: true, update: true } }),
    ]);

    const res = await api.delete(`/admin/${target.userId}`).set(auth(caller.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on roles");
  });

  it("returns 404 for a user without an admin record", async () => {
    const rider = await createPhoneAccount(superAdmin.token, "rider");

    const res = await api.delete(`/admin/${rider.id}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
  });
});

describe("Signing in after changes", () => {
  it("an admin moved to another role gets that role's permissions straight away", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, { users: { read: true } });
    const settingsRole = await createRole(superAdmin.token, { settings: { read: true } });
    expectStatus(await api.get("/settings").set(auth(admin.token)), 403);

    await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ roleId: settingsRole.id })
      .expect(200);

    expectStatus(await api.get("/settings").set(auth(admin.token)), 200);
    const me = await login(admin.email, admin.password);
    expect(me.account.permissions).toEqual({
      settings: { create: false, read: true, update: false, delete: false },
    });
  });
});
