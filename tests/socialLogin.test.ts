import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { captureCode } from "./helpers/outbox.js";
import {
  createAdminAccount,
  createRole,
  fullPhone,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newEmail } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import db from "../src/database/knex.js";
import { loggableBody } from "../src/middlewares/httpLogger.js";
import type { SocialIdentity, SocialProvider } from "../src/services/socialAuth.service.js";

type Identity = Omit<SocialIdentity, "provider">;
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
});

// A Google/Apple person no account knows yet, with a verified email unless told otherwise.
async function newIdentity(overrides: Partial<Identity> = {}): Promise<Identity> {
  const person = data.person();
  return {
    providerUserId: `test-${randomUUID()}`,
    email: await newEmail(person),
    fullName: person.fullName,
    picture: "https://lh3.googleusercontent.com/a/test-avatar",
    ...overrides,
  };
}

async function socialLogin(
  identity: Identity,
  body: { provider?: SocialProvider; role?: "rider" | "driver"; fullName?: string } = {},
) {
  const { provider = "google", ...rest } = body;
  const res = await api
    .post("/auth/social-login")
    .send({ provider, providerToken: JSON.stringify(identity), ...rest });
  const userId: string | undefined = res.body.data?.user?.id;
  if (userId) {
    trackForCleanup("users", { id: userId });
    trackForCleanup("authSessions", { userId });
    trackForCleanup("socialAccounts", { userId });
  }
  return res;
}

function linksOf(userId: string) {
  return db("socialAccounts").where({ userId }).select("provider", "providerUserId", "email");
}

// Gives an account the test made an email, through the admin API (which leaves it unverified).
async function giveEmail(userId: string) {
  const email = await newEmail(data.person());
  expectStatus(
    await api.patch(`/users/${userId}`).set(auth(superAdmin.token)).send({ email }),
    200,
  );
  return email;
}

describe("POST /auth/social-login", () => {
  it("signs up a rider with no phone number, using the verified email, name and picture from the token", async () => {
    const identity = await newIdentity();

    const res = await socialLogin(identity, { role: "rider" });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Login successful");
    const { accessToken, refreshToken, user, isNewUser } = res.body.data;
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));
    expect(isNewUser).toBe(true);
    expect(user).toMatchObject({
      role: "rider",
      status: "active",
      email: identity.email,
      isEmailVerified: true,
      fullName: identity.fullName,
      profilePicture: identity.picture,
      phoneCountryCode: null,
      phoneNumber: null,
      isPhoneVerified: false,
      isProfileComplete: false,
      profile: null,
    });
    expect(user).not.toHaveProperty("oauthProvider");
    expect(await linksOf(user.id)).toEqual([
      { provider: "google", providerUserId: identity.providerUserId, email: identity.email },
    ]);

    const me = await api.get("/auth/me").set(auth(accessToken));
    expectStatus(me, 200);
    expect(me.body.data.id).toBe(user.id);
  });

  it("signs the same person back in to the same account, without a role, even after their email changes", async () => {
    const identity = await newIdentity();
    const first = await socialLogin(identity, { role: "driver" });
    expectStatus(first, 200);

    const again = await socialLogin({ ...identity, email: await newEmail(data.person()) });

    expectStatus(again, 200);
    expect(again.body.data.isNewUser).toBe(false);
    expect(again.body.data.user).toMatchObject({
      id: first.body.data.user.id,
      role: "driver",
      email: identity.email,
    });
  });

  it("requires a role to sign up", async () => {
    const res = await socialLogin(await newIdentity());

    expectError(res, 400, "role is required to sign up");
  });

  it("leaves the email empty when the provider hasn't verified one", async () => {
    const res = await socialLogin(await newIdentity({ email: null }), { role: "rider" });

    expectStatus(res, 200);
    expect(res.body.data.user).toMatchObject({ email: null, isEmailVerified: false });
  });

  it("names an Apple sign-up with the name the app sends, since Apple's token has none", async () => {
    const fullName = data.person().fullName;

    const res = await socialLogin(await newIdentity({ fullName: null, picture: null }), {
      provider: "apple",
      role: "rider",
      fullName,
    });

    expectStatus(res, 200);
    expect(res.body.data.user).toMatchObject({ fullName, profilePicture: null });
    expect((await linksOf(res.body.data.user.id))[0].provider).toBe("apple");
  });

  it("prefers the name in the token over the one the app sends", async () => {
    const identity = await newIdentity();

    const res = await socialLogin(identity, { role: "rider", fullName: data.person().fullName });

    expectStatus(res, 200);
    expect(res.body.data.user.fullName).toBe(identity.fullName);
  });

  it("links a phone account with the same email, marks the email verified, and signs in to it", async () => {
    const rider = await signUpByPhone("rider");
    const email = await giveEmail(rider.userId);
    const identity = await newIdentity({ email });

    const res = await socialLogin(identity);

    expectStatus(res, 200);
    expect(res.body.data.isNewUser).toBe(false);
    expect(res.body.data.user).toMatchObject({
      id: rider.userId,
      email,
      isEmailVerified: true,
      phoneCountryCode: rider.phoneCountryCode,
      phoneNumber: rider.phoneNumber,
      fullName: rider.fullName,
    });
    expect(await linksOf(rider.userId)).toEqual([
      { provider: "google", providerUserId: identity.providerUserId, email },
    ]);

    // Linked now: Apple too, by the same email, and both stay linked.
    const apple = await socialLogin(await newIdentity({ email }), { provider: "apple" });
    expectStatus(apple, 200);
    expect(apple.body.data.user.id).toBe(rider.userId);
    expect((await linksOf(rider.userId)).map((link) => link.provider).sort()).toEqual([
      "apple",
      "google",
    ]);
  });

  it("refuses admin accounts", async () => {
    const roleId = (await createRole(superAdmin.token)).id;
    const admin = await createAdminAccount(superAdmin.token, { roleId });

    const res = await socialLogin(await newIdentity({ email: admin.email }), { role: "rider" });

    expectError(res, 403, "Admin accounts sign in with email and password");
    expect(await linksOf(admin.userId)).toEqual([]);
  });

  it("refuses a suspended account", async () => {
    const identity = await newIdentity();
    const signedUp = await socialLogin(identity, { role: "rider" });
    expectStatus(signedUp, 200);
    await db("users").where({ id: signedUp.body.data.user.id }).update({ status: "suspended" });

    expectError(await socialLogin(identity), 403, "Account is not active");
  });

  it("refuses a token the provider didn't sign", async () => {
    const res = await api
      .post("/auth/social-login")
      .send({ provider: "apple", providerToken: "forged", role: "rider" });

    expectError(res, 401, "Invalid Apple token");
  });

  it("keeps the ID token out of the request log", () => {
    const body = {
      provider: "google",
      providerToken: "eyJhbGciOiJSUzI1NiJ9.e30.sig",
      role: "rider",
    };

    expect(loggableBody({ originalUrl: "/auth/social-login", method: "POST", body })).toEqual({
      ...body,
      providerToken: "[REDACTED]",
    });
  });

  it("rejects an unknown provider", async () => {
    const res = await socialLogin(await newIdentity(), {
      provider: "facebook" as SocialProvider,
      role: "rider",
    });

    expectStatus(res, 400);
  });

  it("creates one account when the same person signs up twice at once", async () => {
    const identity = await newIdentity();

    const results = await Promise.all([
      socialLogin(identity, { role: "rider" }),
      socialLogin(identity, { role: "rider" }),
    ]);

    // Either the second found the first's account, or it lost the race and was told to retry.
    const statuses = results.map((res) => res.status).sort();
    expect([
      [200, 200],
      [200, 409],
    ]).toContainEqual(statuses);
    const accounts = await db("users").where({ email: identity.email }).select("id");
    expect(accounts).toHaveLength(1);
    trackForCleanup("users", { id: accounts[0].id });
    trackForCleanup("socialAccounts", { userId: accounts[0].id });
  });

  it("no longer reaches an account whose phone number was re-registered by someone else", async () => {
    const rider = await signUpByPhone("rider");
    const email = await giveEmail(rider.userId);
    const identity = await newIdentity({ email });
    expectStatus(await socialLogin(identity), 200);
    expectStatus(await api.delete(`/users/${rider.userId}`).set(auth(superAdmin.token)), 200);

    // The number's new owner signs up with it, which reactivates the same row with a clean profile.
    const phone = { phoneCountryCode: rider.phoneCountryCode, phoneNumber: rider.phoneNumber };
    const code = await captureCode(fullPhone(phone), async () => {
      expectStatus(await api.post("/auth/login/otp").send({ ...phone, role: "driver" }), 200);
    });
    const reRegistered = await api
      .post("/auth/login/verify")
      .send({ ...phone, role: "driver", code });
    expectStatus(reRegistered, 200);
    expect(reRegistered.body.data.user.id).toBe(rider.userId);

    expect(await linksOf(rider.userId)).toEqual([]);
    // The old owner's Google sign-in now finds nothing: no link and no account with that email.
    expectError(await socialLogin(identity), 400, "role is required to sign up");
  });
});

// The real verifier (tests/setup.ts mocks it for everything else), against tokens signed with a local key: the provider key endpoints are answered by a fetch
// stub, so nothing reaches Google or Apple. Sequential because it changes env vars and the stubbed responses.
describe("verifySocialToken", { concurrent: false }, () => {
  const googleClientId = "test-client.apps.googleusercontent.com";
  const appleClientId = "com.nframa.customer";
  let verifySocialToken: typeof import("../src/services/socialAuth.service.js").verifySocialToken;
  let privateKey: SigningKey;
  let publicJwk: JWK;
  let keysUp = true;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    ({ verifySocialToken } = await vi.importActual<
      typeof import("../src/services/socialAuth.service.js")
    >("../src/services/socialAuth.service.js"));
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
    process.env.GOOGLE_CLIENT_IDS = `other-platform-id, ${googleClientId}`;
    process.env.APPLE_CLIENT_IDS = appleClientId;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!/googleapis\.com|appleid\.apple\.com/.test(url)) {
        return realFetch(input, init);
      }
      return keysUp
        ? Response.json({ keys: [publicJwk] })
        : new Response("Service Unavailable", { status: 503 });
    });
  });

  afterAll(() => {
    vi.mocked(globalThis.fetch).mockRestore();
  });

  function sign(
    claims: Record<string, unknown>,
    {
      issuer = "https://accounts.google.com",
      audience = googleClientId,
      expiresIn = "1h",
      key = privateKey,
    }: { issuer?: string; audience?: string; expiresIn?: string | number; key?: SigningKey } = {},
  ) {
    return new SignJWT({ sub: "109876543210", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(key);
  }

  const apple = { issuer: "https://appleid.apple.com", audience: appleClientId };

  // First, while nothing is cached: once the keys are fetched they're reused, so the fetch wouldn't happen later.
  it("answers 502 when the provider's keys can't be fetched", async () => {
    keysUp = false;
    try {
      await expect(verifySocialToken("apple", await sign({}, apple))).rejects.toMatchObject({
        statusCode: 502,
        message: "Couldn't reach Apple to check the sign-in, try again",
      });
    } finally {
      keysUp = true;
    }
  });

  it("reads a Google token: the person's id, lowercased verified email, name and picture", async () => {
    const token = await sign({
      email: "Ama.Mensah@Example.com",
      email_verified: true,
      name: "Ama Mensah",
      picture: "https://lh3.googleusercontent.com/a/ama",
    });

    await expect(verifySocialToken("google", token)).resolves.toEqual({
      provider: "google",
      providerUserId: "109876543210",
      email: "ama.mensah@example.com",
      fullName: "Ama Mensah",
      picture: "https://lh3.googleusercontent.com/a/ama",
    });
  });

  it("drops an email the provider hasn't verified", async () => {
    const token = await sign({ email: "kofi@example.com", email_verified: false });

    await expect(verifySocialToken("google", token)).resolves.toMatchObject({ email: null });
  });

  it("reads Apple's email_verified string and finds no name", async () => {
    const token = await sign(
      { email: "abc123@privaterelay.appleid.com", email_verified: "true" },
      apple,
    );

    await expect(verifySocialToken("apple", token)).resolves.toEqual({
      provider: "apple",
      providerUserId: "109876543210",
      email: "abc123@privaterelay.appleid.com",
      fullName: null,
      picture: null,
    });
  });

  it.each([
    ["issued to another app", { audience: "someone-elses-app" }],
    ["issued by someone else", { issuer: "https://evil.example.com" }],
    ["expired", { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
  ])("refuses a token %s", async (_case, options) => {
    await expect(verifySocialToken("google", await sign({}, options))).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid Google token",
    });
  });

  it("refuses a token signed with a different key", async () => {
    const { privateKey: otherKey } = await generateKeyPair("RS256");

    await expect(
      verifySocialToken("google", await sign({}, { key: otherKey })),
    ).rejects.toMatchObject({ statusCode: 401, message: "Invalid Google token" });
  });

  it("refuses something that isn't a JWT", async () => {
    await expect(verifySocialToken("apple", "not-a-jwt")).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid Apple token",
    });
  });

  it("answers 503 when the provider has no client ids configured", async () => {
    const saved = process.env.GOOGLE_CLIENT_IDS;
    process.env.GOOGLE_CLIENT_IDS = " , ";
    try {
      await expect(verifySocialToken("google", await sign({}))).rejects.toMatchObject({
        statusCode: 503,
        message: "Google sign-in is not configured",
      });
    } finally {
      process.env.GOOGLE_CLIENT_IDS = saved;
    }
  });
});
