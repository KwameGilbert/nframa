import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { captureCode, messageCountTo, wrongCode } from "./helpers/outbox.js";
import {
  createAdminAccount,
  createRole,
  fullPhone,
  login,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newEmail, newPhone } from "./helpers/unique.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let roleId: string;

// A fresh active admin with an email and password, on a role with users: read.
function newAdmin(status: "active" | "invited" | "suspended" = "active") {
  return createAdminAccount(superAdmin.token, { roleId, status });
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  roleId = (await createRole(superAdmin.token, { users: { read: true } })).id;
});

describe("POST /auth/login", () => {
  it("signs in with email and password and returns tokens with the account", async () => {
    const admin = await newAdmin();

    const res = await api
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Login successful");
    const { accessToken, refreshToken, user } = res.body.data;
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));
    expect(user).toMatchObject({
      id: admin.userId,
      email: admin.email,
      fullName: admin.fullName,
      role: "admin",
      profile: { userId: admin.userId, roleId, status: "active" },
      adminRole: { id: roleId, isSystem: false },
      permissions: { users: { create: false, read: true, update: false, delete: false } },
    });
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("passwordSalt");
  });

  it("treats the email as case-insensitive", async () => {
    const admin = await newAdmin();

    const res = await api
      .post("/auth/login")
      .send({ email: admin.email.toUpperCase(), password: admin.password });

    expectStatus(res, 200);
    expect(res.body.data.user.id).toBe(admin.userId);
  });

  it("rejects a wrong password", async () => {
    const admin = await newAdmin();

    const res = await api
      .post("/auth/login")
      .send({ email: admin.email, password: data.password() });

    expectStatus(res, 401);
    expect(res.body).toEqual({ success: false, error: "Invalid email or password" });
  });

  it("gives an unknown email the same answer as a wrong password", async () => {
    const res = await api
      .post("/auth/login")
      .send({ email: await newEmail(data.person()), password: data.password() });

    expectStatus(res, 401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("rejects a request without a password", async () => {
    const res = await api.post("/auth/login").send({ email: data.email(data.person()) });

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^password:/);
  });

  it("gives the super admin every permission", async () => {
    const { account } = superAdmin;

    expect(account.adminRole).toMatchObject({ slug: "superadmin", isSystem: true });
    const everything = { create: true, read: true, update: true, delete: true };
    expect(account.permissions).toEqual({
      settings: everything,
      roles: everything,
      users: everything,
    });
  });

  it("refuses an admin who hasn't been activated yet", async () => {
    const admin = await newAdmin("invited");

    const res = await api
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Admin account is not active");
  });

  it("refuses a suspended admin", async () => {
    const admin = await newAdmin("suspended");

    const res = await api
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Admin account is not active");
  });

  it("locks the account for 15 minutes after 10 failed attempts, even for the right password", async () => {
    const admin = await newAdmin();

    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await api
        .post("/auth/login")
        .send({ email: admin.email, password: data.password() });
      expectStatus(res, 401);
    }
    const res = await api
      .post("/auth/login")
      .send({ email: admin.email, password: admin.password });

    expectStatus(res, 429);
    expect(res.body.success).toBe(false);
    expect(res.headers).toHaveProperty("ratelimit");
  });
});

describe("OTP login by phone", () => {
  it("signs up a new phone number as a rider", async () => {
    const phone = await newPhone();

    const code = await captureCode(fullPhone(phone), async () => {
      const res = await api.post("/auth/login/otp").send({ ...phone, role: "rider" });
      expectStatus(res, 200);
      expect(res.body).toEqual({ success: true, message: "Verification code sent", data: null });
    });
    const res = await api.post("/auth/login/verify").send({ ...phone, role: "rider", code });

    expectStatus(res, 200);
    expect(res.body.data.user).toMatchObject({
      role: "rider",
      phoneCountryCode: phone.phoneCountryCode,
      phoneNumber: phone.phoneNumber,
      status: "active",
      profile: null,
      adminRole: null,
      permissions: {},
    });
  });

  it("needs a role to sign up a number that has no account", async () => {
    const res = await api.post("/auth/login/otp").send(await newPhone());

    expectStatus(res, 400);
    expect(res.body.error).toBe("role is required to sign up");
  });

  it("sends at most 5 codes to one number every 15 minutes", async () => {
    const phone = await newPhone();
    const request = () => api.post("/auth/login/otp").send({ ...phone, role: "rider" });

    for (let attempt = 0; attempt < 5; attempt++) {
      expectStatus(await request(), 200);
    }
    const res = await request();

    expectStatus(res, 429);
    expect(messageCountTo(fullPhone(phone))).toBe(5);
  });

  it("rejects a wrong code", async () => {
    const phone = await newPhone();
    const code = await captureCode(fullPhone(phone), () =>
      api.post("/auth/login/otp").send({ ...phone, role: "driver" }),
    );

    const res = await api
      .post("/auth/login/verify")
      .send({ ...phone, role: "driver", code: wrongCode(code) });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Invalid verification code");
  });

  it("stops accepting a code after 5 wrong attempts", async () => {
    const phone = await newPhone();
    const code = await captureCode(fullPhone(phone), () =>
      api.post("/auth/login/otp").send({ ...phone, role: "rider" }),
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await api
        .post("/auth/login/verify")
        .send({ ...phone, role: "rider", code: wrongCode(code) });
      expectStatus(res, 400);
    }
    const res = await api.post("/auth/login/verify").send({ ...phone, role: "rider", code });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Too many attempts, request a new code");
  });

  it("won't accept the same code twice", async () => {
    const phone = await newPhone();
    const code = await captureCode(fullPhone(phone), () =>
      api.post("/auth/login/otp").send({ ...phone, role: "rider" }),
    );
    const verify = () => api.post("/auth/login/verify").send({ ...phone, role: "rider", code });
    expectStatus(await verify(), 200);

    const res = await verify();

    expectStatus(res, 400);
    expect(res.body.error).toBe("No pending verification code for this identifier");
  });

  it("signs an existing number into its account instead of creating a second one", async () => {
    const rider = await signUpByPhone("rider");
    const phone = { phoneCountryCode: rider.phoneCountryCode, phoneNumber: rider.phoneNumber };

    // role is ignored for a number that already has an account.
    const code = await captureCode(fullPhone(phone), () =>
      api.post("/auth/login/otp").send({ ...phone, role: "driver" }),
    );
    const res = await api.post("/auth/login/verify").send({ ...phone, code });

    expectStatus(res, 200);
    expect(res.body.data.user).toMatchObject({
      id: rider.userId,
      role: "rider",
      fullName: rider.fullName,
    });
  });
});

describe("OTP login by email", () => {
  it("emails an admin a code and signs them in with it", async () => {
    const admin = await newAdmin();

    const code = await captureCode(admin.email, () =>
      api.post("/auth/login/otp").send({ email: admin.email }).expect(200),
    );
    const res = await api.post("/auth/login/verify").send({ email: admin.email, code });

    expectStatus(res, 200);
    expect(res.body.data.user.id).toBe(admin.userId);
  });

  it("doesn't sign up an email that has no account", async () => {
    const res = await api.post("/auth/login/otp").send({ email: await newEmail(data.person()) });

    expectStatus(res, 404);
    expect(res.body.error).toBe("No account found for this identifier");
  });
});

describe("GET /auth/me", () => {
  it("returns the signed-in account", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.get("/auth/me").set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Account retrieved successfully");
    expect(res.body.data).toMatchObject({
      id: rider.userId,
      fullName: rider.fullName,
      role: "rider",
      adminRole: null,
      permissions: {},
    });
  });

  it("needs an access token", async () => {
    const res = await api.get("/auth/me");

    expectStatus(res, 401);
    expect(res.body.error).toBe("Missing or invalid Authorization header");
  });

  it("rejects a tampered access token", async () => {
    const res = await api.get("/auth/me").set(auth(`${superAdmin.token}x`));

    expectStatus(res, 401);
    expect(res.body.error).toBe("Invalid or expired access token");
  });
});

describe("POST /auth/refresh", () => {
  it("swaps a refresh token for a new working pair", async () => {
    const rider = await signUpByPhone("driver");

    const res = await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Tokens refreshed successfully");
    expect(res.body.data.refreshToken).not.toBe(rider.refreshToken);
    expectStatus(await api.get("/auth/me").set(auth(res.body.data.accessToken)), 200);
  });

  it("accepts each refresh token only once", async () => {
    const rider = await signUpByPhone("rider");
    expectStatus(await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken }), 200);

    const res = await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken });

    expectStatus(res, 401);
    expect(res.body.error).toBe("Invalid or expired refresh token");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the refresh token", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.post("/auth/logout").send({ refreshToken: rider.refreshToken });

    expectStatus(res, 200);
    expect(res.body).toEqual({ success: true, message: "Logged out successfully", data: null });
    expectStatus(await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken }), 401);
  });
});

describe("Password reset", () => {
  it("gives the same answer whether or not the email has an account, and only emails real accounts", async () => {
    const admin = await newAdmin();
    const stranger = await newEmail(data.person());

    const code = await captureCode(admin.email, async () => {
      const res = await api.post("/auth/password/forgot").send({ email: admin.email });
      expectStatus(res, 200);
    });
    const res = await api.post("/auth/password/forgot").send({ email: stranger });

    expect(code).toMatch(/^\d{6}$/);
    expectStatus(res, 200);
    expect(res.body.message).toBe(
      "If an account exists for this email, a reset code has been sent",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(messageCountTo(stranger)).toBe(0);
  });

  it("sets a new password with the emailed code and signs out every session", async () => {
    const admin = await newAdmin();
    const before = await login(admin.email, admin.password);
    const newPassword = data.password();

    const code = await captureCode(admin.email, () =>
      api.post("/auth/password/forgot").send({ email: admin.email }),
    );
    const res = await api
      .post("/auth/password/reset")
      .send({ email: admin.email, code, newPassword });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Password reset successfully. Sign in with your new password.");
    expectStatus(await api.post("/auth/refresh").send({ refreshToken: before.refreshToken }), 401);
    expectStatus(
      await api.post("/auth/login").send({ email: admin.email, password: admin.password }),
      401,
    );
    expectStatus(
      await api.post("/auth/login").send({ email: admin.email, password: newPassword }),
      200,
    );
  });

  it("rejects a wrong reset code", async () => {
    const admin = await newAdmin();
    const code = await captureCode(admin.email, () =>
      api.post("/auth/password/forgot").send({ email: admin.email }),
    );

    const res = await api
      .post("/auth/password/reset")
      .send({ email: admin.email, code: wrongCode(code), newPassword: data.password() });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Invalid verification code");
  });
});

describe("POST /auth/password/change", () => {
  it("changes the password, signs out other sessions and returns a new token pair", async () => {
    const admin = await newAdmin();
    const thisDevice = await login(admin.email, admin.password);
    const otherDevice = await login(admin.email, admin.password);
    const newPassword = data.password();

    const res = await api
      .post("/auth/password/change")
      .set(auth(thisDevice.token))
      .send({ currentPassword: admin.password, newPassword });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Password changed successfully");
    expectStatus(
      await api.post("/auth/refresh").send({ refreshToken: otherDevice.refreshToken }),
      401,
    );
    expectStatus(
      await api.post("/auth/refresh").send({ refreshToken: res.body.data.refreshToken }),
      200,
    );
    expectStatus(
      await api.post("/auth/login").send({ email: admin.email, password: newPassword }),
      200,
    );
  });

  it("rejects a wrong current password", async () => {
    const admin = await newAdmin();
    const session = await login(admin.email, admin.password);

    const res = await api
      .post("/auth/password/change")
      .set(auth(session.token))
      .send({ currentPassword: data.password(), newPassword: data.password() });

    expectStatus(res, 400);
    expect(res.body.error).toBe("Current password is incorrect");
  });

  it("rejects a new password that's the same as the current one", async () => {
    const admin = await newAdmin();
    const session = await login(admin.email, admin.password);

    const res = await api
      .post("/auth/password/change")
      .set(auth(session.token))
      .send({ currentPassword: admin.password, newPassword: admin.password });

    expectStatus(res, 400);
    expect(res.body.error).toBe(
      "newPassword: New password must be different from the current password",
    );
  });

  it("tells an account without a password to use forgot password", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api
      .post("/auth/password/change")
      .set(auth(rider.token))
      .send({ currentPassword: data.password(), newPassword: data.password() });

    expectStatus(res, 400);
    expect(res.body.error).toBe(
      "This account has no password yet — use forgot password to set one",
    );
  });

  it("needs a signed-in user", async () => {
    const res = await api
      .post("/auth/password/change")
      .send({ currentPassword: data.password(), newPassword: data.password() });

    expectStatus(res, 401);
  });
});

describe("Deleted accounts", () => {
  it("can't sign in, refresh, or use an old access token", async () => {
    const rider = await signUpByPhone("rider");
    expectStatus(await api.delete(`/users/${rider.userId}`).set(auth(rider.token)), 200);

    const otp = await api
      .post("/auth/login/otp")
      .send({ phoneCountryCode: rider.phoneCountryCode, phoneNumber: rider.phoneNumber });
    const refresh = await api.post("/auth/refresh").send({ refreshToken: rider.refreshToken });
    const me = await api.get("/auth/me").set(auth(rider.token));

    expectStatus(otp, 403);
    expect(otp.body.error).toBe("Account is not active");
    expectStatus(refresh, 401);
    expectStatus(me, 403);
    expect(me.body.error).toBe("Account is not active");
  });
});
