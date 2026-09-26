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

type SignedInAdmin = Awaited<ReturnType<typeof createSignedInAdmin>>;

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let supportAgent: SignedInAdmin; // users: read
let userManager: SignedInAdmin; // full users access, nothing on roles
let accessManager: SignedInAdmin; // roles: read + delete, not a system role
let rider: Awaited<ReturnType<typeof signUpByPhone>>;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [supportAgent, userManager, accessManager, rider] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    createSignedInAdmin(superAdmin.token, {
      users: { create: true, read: true, update: true, delete: true },
    }),
    createSignedInAdmin(superAdmin.token, { roles: { read: true, delete: true } }),
    signUpByPhone("rider"),
  ]);
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

  it("needs roles: create, not users: create, to add an admin account", async () => {
    const person = data.person();

    const res = await api
      .post("/users")
      .set(auth(userManager.token))
      .send({ fullName: person.fullName, email: data.email(person), role: "admin" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on roles");
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

  it("needs roles: read to view an admin account", async () => {
    const res = await api.get(`/users/${userManager.userId}`).set(auth(supportAgent.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on roles");
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

  it("needs users: update to change a phone number, even your own", async () => {
    const self = await signUpByPhone("rider");

    const res = await api
      .patch(`/users/${self.userId}`)
      .set(auth(self.token))
      .send({ phoneNumber: data.ghanaPhoneNumber() });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on users");
  });

  it("lets an admin with users: update change a rider's phone number", async () => {
    const target = await createPhoneAccount(userManager.token, "rider");
    const { phoneNumber } = await newPhone();

    const res = await api
      .patch(`/users/${target.id}`)
      .set(auth(userManager.token))
      .send({ phoneNumber });

    expectStatus(res, 200);
    expect(res.body.data.phoneNumber).toBe(phoneNumber);
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

  it("needs roles: update, not users: update, to edit an admin account", async () => {
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
    expect(res.body.error).toBe("Missing permission: update on roles");
  });

  it("rejects an empty update", async () => {
    const res = await api.patch(`/users/${rider.userId}`).set(auth(rider.token)).send({});

    expectStatus(res, 400);
    expect(res.body.error).toBe("At least one field must be provided");
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

  it("needs roles: delete, not users: delete, to delete an admin account", async () => {
    const role = await createRole(superAdmin.token, { users: { read: true } });
    const target = await createAdminAccount(superAdmin.token, { roleId: role.id });

    const res = await api.delete(`/users/${target.userId}`).set(auth(userManager.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on roles");
  });

  it("doesn't let an admin delete their own account", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {
      roles: { read: true, delete: true },
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
