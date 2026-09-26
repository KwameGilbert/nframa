import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createRole,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
  superAdminRoleId,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newRole } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";

const everything = { create: true, read: true, update: true, delete: true };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let superRoleId: string;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  superRoleId = await superAdminRoleId(superAdmin.token);
});

describe("GET /roles", () => {
  it("lists roles with their permissions and how many admins are on each", async () => {
    const res = await api.get("/roles").set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Roles retrieved successfully");
    const superRole = res.body.data.find((role: { id: string }) => role.id === superRoleId);
    expect(superRole).toMatchObject({
      slug: "superadmin",
      isSystem: true,
      permissions: { settings: everything, roles: everything, users: everything },
    });
    expect(superRole.assignedAdminsCount).toBeGreaterThanOrEqual(1);
  });

  it("needs roles: read", async () => {
    const supportAgent = await createSignedInAdmin(superAdmin.token, { users: { read: true } });

    const res = await api.get("/roles").set(auth(supportAgent.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on roles");
  });

  it("isn't open to riders", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.get("/roles").set(auth(rider.token));

    expectStatus(res, 403);
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.get("/roles"), 401);
  });
});

describe("POST /roles", () => {
  it("creates a role; actions left out default to false", async () => {
    const role = await newRole();

    const res = await api
      .post("/roles")
      .set(auth(superAdmin.token))
      .send({
        ...role,
        permissions: { users: { read: true, update: true }, settings: { read: true } },
      });

    expectStatus(res, 201);
    trackForCleanup("roles", { id: res.body.data.id });
    expect(res.body.message).toBe("Role created successfully");
    expect(res.body.data).toMatchObject({
      ...role,
      isSystem: false,
      assignedAdminsCount: 0,
      permissions: {
        users: { create: false, read: true, update: true, delete: false },
        settings: { create: false, read: true, update: false, delete: false },
      },
    });
  });

  it("creates a role with no access when permissions are left out", async () => {
    const res = await api
      .post("/roles")
      .set(auth(superAdmin.token))
      .send(await newRole());

    expectStatus(res, 201);
    trackForCleanup("roles", { id: res.body.data.id });
    expect(res.body.data.permissions).toEqual({});
  });

  it("keeps slugs unique", async () => {
    const existing = await createRole(superAdmin.token);

    const res = await api
      .post("/roles")
      .set(auth(superAdmin.token))
      .send({ ...(await newRole()), slug: existing.slug });

    expectStatus(res, 409);
  });

  it("rejects a module that doesn't exist", async () => {
    const res = await api
      .post("/roles")
      .set(auth(superAdmin.token))
      .send({ ...data.role(), permissions: { payouts: { read: true } } });

    expectStatus(res, 400);
  });

  it("needs roles: create", async () => {
    const viewer = await createSignedInAdmin(superAdmin.token, { roles: { read: true } });

    const res = await api.post("/roles").set(auth(viewer.token)).send(data.role());

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on roles");
  });
});

describe("GET /roles/:id", () => {
  it("returns the role with its permissions", async () => {
    const role = await createRole(superAdmin.token, { roles: { read: true } });

    const res = await api.get(`/roles/${role.id}`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Role retrieved successfully");
    expect(res.body.data).toMatchObject({
      id: role.id,
      name: role.name,
      permissions: { roles: { create: false, read: true, update: false, delete: false } },
    });
  });

  it("returns 404 for an unknown role", async () => {
    const id = "7c2e4a1b-5d3f-4b6a-8e9c-0f1a2b3c4d5e";

    const res = await api.get(`/roles/${id}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Role not found: ${id}`);
  });
});

describe("PATCH /roles/:id", () => {
  it("updates the role's details", async () => {
    const role = await createRole(superAdmin.token);
    const description = "Reviews driver documents before they go live";

    const res = await api
      .patch(`/roles/${role.id}`)
      .set(auth(superAdmin.token))
      .send({ description });

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      message: "Role updated successfully",
      data: { id: role.id, description },
    });
  });

  it("replaces the whole permission set when permissions are sent", async () => {
    const role = await createRole(superAdmin.token, {
      users: { read: true },
      settings: { read: true },
    });

    const res = await api
      .patch(`/roles/${role.id}`)
      .set(auth(superAdmin.token))
      .send({ permissions: { roles: { read: true } } });

    expectStatus(res, 200);
    expect(res.body.data.permissions).toEqual({
      roles: { create: false, read: true, update: false, delete: false },
    });
  });

  it("rejects an empty update", async () => {
    const role = await createRole(superAdmin.token);

    const res = await api.patch(`/roles/${role.id}`).set(auth(superAdmin.token)).send({});

    expectStatus(res, 400);
    expect(res.body.error).toBe("At least one field must be provided");
  });

  it("won't edit a system role", async () => {
    const current = await api.get(`/roles/${superRoleId}`).set(auth(superAdmin.token));

    // Sends the current description, so even if the guard ever broke nothing would change.
    const res = await api
      .patch(`/roles/${superRoleId}`)
      .set(auth(superAdmin.token))
      .send({ description: current.body.data.description });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Super Admin is a system role and can't be edited or deleted");
  });

  it("needs roles: update", async () => {
    const [role, viewer] = await Promise.all([
      createRole(superAdmin.token),
      createSignedInAdmin(superAdmin.token, { roles: { read: true } }),
    ]);

    const res = await api
      .patch(`/roles/${role.id}`)
      .set(auth(viewer.token))
      .send({ description: "Handles payouts and refunds" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on roles");
  });
});

describe("DELETE /roles/:id", () => {
  it("deletes a role nobody is on", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });

    const res = await api.delete(`/roles/${role.id}`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body).toEqual({ success: true, message: "Role deleted successfully", data: null });
    expectStatus(await api.get(`/roles/${role.id}`).set(auth(superAdmin.token)), 404);
  });

  it("won't delete a role that admins are on", async () => {
    const role = await createRole(superAdmin.token);
    await createAdminAccount(superAdmin.token, { roleId: role.id, status: "invited" });

    const res = await api.delete(`/roles/${role.id}`).set(auth(superAdmin.token));

    expectStatus(res, 409);
    expect(res.body.error).toMatch(/is still assigned to 1 admin account/);
  });

  it("won't delete a system role", async () => {
    // Safe to aim at the real super admin role: even if this guard broke, admins are assigned to it (409)
    // and adminUsers.roleId is ON DELETE RESTRICT, so it still couldn't be deleted.
    const res = await api.delete(`/roles/${superRoleId}`).set(auth(superAdmin.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Super Admin is a system role and can't be edited or deleted");
  });

  it("needs roles: delete", async () => {
    const [role, viewer] = await Promise.all([
      createRole(superAdmin.token),
      createSignedInAdmin(superAdmin.token, { roles: { read: true, update: true } }),
    ]);

    const res = await api.delete(`/roles/${role.id}`).set(auth(viewer.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on roles");
  });
});
