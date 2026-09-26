import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createRole,
  createSignedInAdmin,
  login,
  loginAsSuperAdmin,
  superAdminRoleId,
} from "./helpers/actors.js";

const readOnly = { create: false, read: true, update: false, delete: false };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
});

describe("GET /roles/:id/permissions", () => {
  it("returns the role's permissions per module", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });

    const res = await api.get(`/roles/${role.id}/permissions`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body).toEqual({
      success: true,
      message: "Role permissions retrieved successfully",
      data: { users: readOnly },
    });
  });

  it("returns 404 for an unknown role", async () => {
    const res = await api
      .get("/roles/3e1d2c4b-6a5f-4e7d-8c9b-0a1f2e3d4c5b/permissions")
      .set(auth(superAdmin.token));

    expectStatus(res, 404);
  });

  it("needs roles: read", async () => {
    const [role, supportAgent] = await Promise.all([
      createRole(superAdmin.token),
      createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    ]);

    const res = await api.get(`/roles/${role.id}/permissions`).set(auth(supportAgent.token));

    expectStatus(res, 403);
  });
});

describe("PUT /roles/:id/permissions/:module", () => {
  it("sets one module's access; actions left out are false, other modules are untouched", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });

    const res = await api
      .put(`/roles/${role.id}/permissions/settings`)
      .set(auth(superAdmin.token))
      .send({ read: true, update: true });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Role permission updated successfully");
    expect(res.body.data).toEqual({
      users: readOnly,
      settings: { create: false, read: true, update: true, delete: false },
    });
  });

  it("replaces a module's existing access rather than merging", async () => {
    const role = await createRole(superAdmin.token, {
      users: { create: true, read: true, update: true },
    });

    const res = await api
      .put(`/roles/${role.id}/permissions/users`)
      .set(auth(superAdmin.token))
      .send({ read: true });

    expectStatus(res, 200);
    expect(res.body.data).toEqual({ users: readOnly });
  });

  it("removes the module when every action is false", async () => {
    const role = await createRole(superAdmin.token, {
      users: { read: true },
      settings: { read: true },
    });

    const res = await api
      .put(`/roles/${role.id}/permissions/settings`)
      .set(auth(superAdmin.token))
      .send({});

    expectStatus(res, 200);
    expect(res.body.data).toEqual({ users: readOnly });
  });

  it("rejects a module that doesn't exist", async () => {
    const role = await createRole(superAdmin.token);

    const res = await api
      .put(`/roles/${role.id}/permissions/payouts`)
      .set(auth(superAdmin.token))
      .send({ read: true });

    expectStatus(res, 400);
  });

  it("won't change a system role", async () => {
    const superRoleId = await superAdminRoleId(superAdmin.token);

    // Full access is what the super admin already has, so even if the guard ever broke nothing would change.
    const res = await api
      .put(`/roles/${superRoleId}/permissions/settings`)
      .set(auth(superAdmin.token))
      .send({ create: true, read: true, update: true, delete: true });

    expectStatus(res, 403);
  });

  it("needs roles: update", async () => {
    const [role, viewer] = await Promise.all([
      createRole(superAdmin.token),
      createSignedInAdmin(superAdmin.token, { roles: { read: true } }),
    ]);

    const res = await api
      .put(`/roles/${role.id}/permissions/users`)
      .set(auth(viewer.token))
      .send({ read: true });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on roles");
  });
});

describe("DELETE /roles/:id/permissions/:module", () => {
  it("removes the role's access to the module", async () => {
    const role = await createRole(superAdmin.token, {
      users: { read: true },
      settings: { read: true },
    });

    const res = await api.delete(`/roles/${role.id}/permissions/users`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Role permission removed successfully");
    expect(res.body.data).toEqual({ settings: readOnly });
  });

  it("needs roles: update", async () => {
    const [role, viewer] = await Promise.all([
      createRole(superAdmin.token, { users: { read: true } }),
      createSignedInAdmin(superAdmin.token, { roles: { read: true } }),
    ]);

    const res = await api.delete(`/roles/${role.id}/permissions/users`).set(auth(viewer.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on roles");
  });

  // The system-role guard here is the same one the PUT test covers. It isn't aimed at the super admin role
  // from a DELETE, because if the guard ever broke that request would really remove its access.

  it("returns 404 for an unknown role", async () => {
    const res = await api
      .delete("/roles/3e1d2c4b-6a5f-4e7d-8c9b-0a1f2e3d4c5b/permissions/users")
      .set(auth(superAdmin.token));

    expectStatus(res, 404);
  });
});

describe("Changes take effect immediately", () => {
  it("an admin loses access on their next request once it's removed from their role", async () => {
    const role = await createRole(superAdmin.token, { settings: { read: true } });
    const account = await createAdminAccount(superAdmin.token, { roleId: role.id });
    const admin = await login(account.email, account.password);
    expectStatus(await api.get("/settings").set(auth(admin.token)), 200);

    await api
      .delete(`/roles/${role.id}/permissions/settings`)
      .set(auth(superAdmin.token))
      .expect(200);

    const res = await api.get("/settings").set(auth(admin.token));
    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on settings");
  });

  it("an admin gains access on their next request once it's granted", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });
    const account = await createAdminAccount(superAdmin.token, { roleId: role.id });
    const admin = await login(account.email, account.password);
    expectStatus(await api.get("/roles").set(auth(admin.token)), 403);

    await api
      .put(`/roles/${role.id}/permissions/roles`)
      .set(auth(superAdmin.token))
      .send({ read: true })
      .expect(200);

    expectStatus(await api.get("/roles").set(auth(admin.token)), 200);
  });
});
