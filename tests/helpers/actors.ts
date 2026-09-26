import { api, auth, expectStatus } from "./api.js";
import { captureCode } from "./outbox.js";
import * as data from "./data.js";
import { newEmail, newPhone, newRole } from "./unique.js";
import type { Module, ModuleActions } from "../../src/config/permissions.js";

// The accounts tests act as. Everything here goes through the API, like a real client would.

export type Grants = Partial<Record<Module, Partial<ModuleActions>>>;

export interface Session {
  userId: string;
  token: string;
  refreshToken: string;
}

export async function login(email: string, password: string) {
  const res = await api.post("/auth/login").send({ email, password });
  expectStatus(res, 200);
  return {
    userId: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
    account: res.body.data.user,
  };
}

const superAdminRefreshTokens: string[] = [];

// The seeded super admin. Tests only sign in as it and use it to act on test records — they never change it.
export async function loginAsSuperAdmin() {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD must be set (in .env.test or .env.development) so tests can sign in as the seeded super admin",
    );
  }
  const session = await login(process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@nframa.com", password);
  superAdminRefreshTokens.push(session.refreshToken);
  return session;
}

// Called after each test file (tests/setup.ts) so no live super admin session outlives the tests.
export async function logOutSuperAdmin() {
  const tokens = superAdminRefreshTokens.splice(0);
  await Promise.all(tokens.map((refreshToken) => api.post("/auth/logout").send({ refreshToken })));
}

export function fullPhone(phone: { phoneCountryCode: string; phoneNumber: string }) {
  return `${phone.phoneCountryCode}${phone.phoneNumber}`;
}

// Signs up a new rider or driver the way the app does: phone number, SMS code, then their name.
export async function signUpByPhone(role: "rider" | "driver") {
  const phone = await newPhone();
  const { fullName } = data.person();

  const code = await captureCode(fullPhone(phone), () =>
    api
      .post("/auth/login/otp")
      .send({ ...phone, role })
      .expect(200),
  );
  // A new number needs the role on verify too — that's when the account is created.
  const res = await api.post("/auth/login/verify").send({ ...phone, role, code });
  expectStatus(res, 200);

  const session: Session = {
    userId: res.body.data.user.id,
    token: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };

  const named = await api
    .patch(`/users/${session.userId}`)
    .set(auth(session.token))
    .send({ fullName });
  expectStatus(named, 200);

  return { ...session, ...phone, fullName };
}

// A rider or driver account created by an admin (no sign-in).
export async function createPhoneAccount(adminToken: string, role: "rider" | "driver") {
  const res = await api
    .post("/users")
    .set(auth(adminToken))
    .send({ fullName: data.person().fullName, ...(await newPhone()), role });
  expectStatus(res, 201);
  return res.body.data as { id: string; fullName: string; phoneNumber: string };
}

export async function createRole(adminToken: string, permissions: Grants = {}) {
  const res = await api
    .post("/roles")
    .set(auth(adminToken))
    .send({ ...(await newRole()), permissions });
  expectStatus(res, 201);
  return res.body.data as { id: string; slug: string; name: string; description: string };
}

export async function superAdminRoleId(adminToken: string): Promise<string> {
  const res = await api.get("/roles").set(auth(adminToken));
  expectStatus(res, 200);
  return res.body.data.find((role: { slug: string }) => role.slug === "superadmin").id;
}

// An admin account with a password, on the given role. New admins start invited; pass status to change it.
export async function createAdminAccount(
  adminToken: string,
  { roleId, status = "active" }: { roleId: string; status?: "active" | "invited" | "suspended" },
) {
  const person = data.person();
  const email = await newEmail(person);
  const password = data.password();

  const user = await api
    .post("/users")
    .set(auth(adminToken))
    .send({ fullName: person.fullName, email, role: "admin" });
  expectStatus(user, 201);
  const userId: string = user.body.data.id;

  const admin = await api
    .post("/admin")
    .set(auth(adminToken))
    .send({ userId, roleId, department: data.department(), password });
  expectStatus(admin, 201);

  if (status !== "invited") {
    const updated = await api.patch(`/admin/${userId}`).set(auth(adminToken)).send({ status });
    expectStatus(updated, 200);
  }

  return { userId, email, password, roleId, fullName: person.fullName };
}

// A signed-in admin on a new role with exactly these permissions.
export async function createSignedInAdmin(adminToken: string, permissions: Grants) {
  const role = await createRole(adminToken, permissions);
  const account = await createAdminAccount(adminToken, { roleId: role.id });
  const session = await login(account.email, account.password);
  return { ...account, ...session };
}
