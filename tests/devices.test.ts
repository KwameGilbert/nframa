import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { MAX_DEVICES_PER_USER } from "../src/config/notificationTypes.js";
import { loggableBody, loggableResponse } from "../src/middlewares/httpLogger.js";
import type { PushDevice } from "../src/models/pushDevice.model.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { deliverNotification } from "../src/services/notification.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createPhoneAccount, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { REQUEST_ID_PREFIX } from "./helpers/cleanup.js";
import {
  expoPushesTo,
  newExpoToken,
  newWebSubscription,
  seedDevice,
  webPushesTo,
} from "./helpers/push.js";

// POST /devices, POST /devices/unregister, GET /push/vapid-key and the pushToken on POST /auth/logout. Each test
// makes its own accounts and tokens; assertions are filtered by them, never by global counts.

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let refusals: Awaited<ReturnType<typeof signUpByPhone>>; // only ever sends requests that are refused or read-only

const ENDPOINT_RULE =
  "Must be the https endpoint exactly as the browser gives it, on a known push service (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com)";

const register = (token: string, body: object) => api.post("/devices").set(auth(token)).send(body);
const unregister = (token: string, pushToken: string) =>
  api.post("/devices/unregister").set(auth(token)).send({ token: pushToken });

const devicesOf = (userId: string): Promise<PushDevice[]> => db("pushDevices").where({ userId });

const content = { title: "Trip accepted", body: "Your driver accepted your trip.", data: {} };

async function auditEntries(action: string, criteria: Record<string, string>) {
  await flushActivityLogs();
  return db("activityLogs")
    .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
    .where({ action, ...criteria });
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  refusals = await signUpByPhone("rider");
});

describe("POST /devices", () => {
  it("registers a phone without ever echoing the token, and audits it with the token blanked", async () => {
    const user = await signUpByPhone("driver");
    const token = newExpoToken();

    const res = await register(user.token, { platform: "ios", token });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Device registered successfully");
    expect(Object.keys(res.body.data).sort()).toEqual(["createdAt", "id", "platform", "updatedAt"]);
    expect(res.body.data.platform).toBe("ios");
    expect(JSON.stringify(res.body)).not.toContain(token);
    const [row] = await devicesOf(user.userId);
    expect(row).toMatchObject({ id: res.body.data.id, platform: "ios", token, webKeys: null });

    const [entry] = await auditEntries("device.register", { targetId: row.id });
    expect(entry).toMatchObject({
      module: "notifications",
      targetType: "pushDevice",
      actorId: user.userId,
      result: "success",
    });
    expect(entry.requestBody).toEqual({ platform: "ios", token: "[REDACTED]" });
    expect(entry.after).toMatchObject({ id: row.id, platform: "ios" });
    expect(JSON.stringify(entry)).not.toContain(token);
  });

  it("keeps one row when the same account registers the token again, and audits only the first time", async () => {
    const user = await signUpByPhone("rider");
    const token = newExpoToken();

    const first = await register(user.token, { platform: "android", token });
    const again = await register(user.token, { platform: "android", token });

    expectStatus(first, 200);
    expectStatus(again, 200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(new Date(again.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.body.data.updatedAt).getTime(),
    );
    expect(await devicesOf(user.userId)).toHaveLength(1);
    expect(await auditEntries("device.register", { targetId: first.body.data.id })).toHaveLength(1);
  });

  it("registers a browser subscription: endpoint and keys are stored, never returned or audited", async () => {
    const user = await signUpByPhone("rider");
    const subscription = newWebSubscription();

    const res = await register(user.token, { platform: "web", subscription });

    expectStatus(res, 200);
    expect(res.body.data.platform).toBe("web");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(subscription.endpoint);
    expect(body).not.toContain(subscription.keys.p256dh);
    const [row] = await devicesOf(user.userId);
    expect(row).toMatchObject({
      platform: "web",
      token: subscription.endpoint,
      webKeys: subscription.keys,
    });

    const [entry] = await auditEntries("device.register", { targetId: row.id });
    expect(entry.requestBody).toEqual({ platform: "web", subscription: "[REDACTED]" });
    expect(JSON.stringify(entry)).not.toContain(subscription.endpoint);
    expect(JSON.stringify(entry)).not.toContain(subscription.keys.auth);

    await deliverNotification(user.userId, "trip.accepted", content);
    expect(webPushesTo(subscription.endpoint)).toHaveLength(1);
  });

  it("moves a token to the account that registers it, so the previous owner stops getting pushes on it", async () => {
    const previous = await createPhoneAccount(superAdmin.token, "rider");
    const token = newExpoToken();
    await seedDevice(previous.id, "ios", token);
    const next = await signUpByPhone("rider");

    const res = await register(next.token, { platform: "ios", token });

    expectStatus(res, 200);
    expect(await devicesOf(previous.id)).toEqual([]);
    expect(await db("pushDevices").where({ token })).toMatchObject([{ userId: next.userId }]);
    expect(await auditEntries("device.register", { targetId: res.body.data.id })).toHaveLength(1);

    await deliverNotification(previous.id, "trip.accepted", content);
    expect(expoPushesTo(token)).toHaveLength(0);
    await deliverNotification(next.userId, "trip.accepted", content);
    expect(expoPushesTo(token)).toHaveLength(1);
  });

  it(`keeps at most ${MAX_DEVICES_PER_USER} devices, dropping the one seen longest ago`, async () => {
    const user = await signUpByPhone("driver");
    const seeded = await Promise.all(
      Array.from({ length: MAX_DEVICES_PER_USER }, (_, i) =>
        seedDevice(user.userId, "android", undefined, {
          updatedAt: new Date(Date.now() - (i + 1) * 60_000),
        }),
      ),
    );
    const oldest = seeded.at(-1) as PushDevice;

    const res = await register(user.token, { platform: "ios", token: newExpoToken() });

    expectStatus(res, 200);
    const ids = (await devicesOf(user.userId)).map((device) => device.id).sort();
    expect(ids).toHaveLength(MAX_DEVICES_PER_USER);
    expect(ids).toContain(res.body.data.id);
    expect(ids).not.toContain(oldest.id);
  });

  const keys = newWebSubscription().keys;
  const web = (subscription: object) => ({ platform: "web", subscription });

  it.each([
    [
      "a malformed token",
      { platform: "ios", token: "not-a-push-token" },
      "token: Must be an Expo push token, e.g. ExponentPushToken[...]",
    ],
    [
      "a missing token",
      { platform: "android" },
      "token: Invalid input: expected string, received undefined",
    ],
    [
      "an unknown platform",
      { platform: "blackberry", token: newExpoToken() },
      "platform: Invalid discriminator value. Expected 'ios' | 'android' | 'web'",
    ],
    [
      "no platform",
      { token: newExpoToken() },
      "platform: Invalid discriminator value. Expected 'ios' | 'android' | 'web'",
    ],
    [
      "a web device sent as a token",
      { platform: "web", token: newExpoToken() },
      "subscription: Invalid input: expected object, received undefined",
    ],
    [
      "a subscription without keys",
      web({ endpoint: newWebSubscription().endpoint }),
      "subscription.keys: Invalid input: expected object, received undefined",
    ],
    [
      "an http endpoint",
      web({ endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "an endpoint on another host",
      web({ endpoint: "https://push.example.com/send/abc", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "a look-alike host",
      web({ endpoint: "https://fcm.googleapis.com.example.com/send/abc", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "an endpoint that isn't a URL",
      web({ endpoint: "fcm.googleapis.com/send/abc", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "a backslash trick (another parser could read the host as evil.com)",
      web({ endpoint: "https://fcm.googleapis.com\\@evil.com/x", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "an upper-case host (not as a browser gives it)",
      web({ endpoint: "https://FCM.googleapis.com/fcm/send/x", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "an explicit port",
      web({ endpoint: "https://fcm.googleapis.com:8443/fcm/send/x", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "user info in the URL",
      web({ endpoint: "https://user:secret@fcm.googleapis.com/fcm/send/x", keys }),
      `subscription.endpoint: ${ENDPOINT_RULE}`,
    ],
    [
      "a short p256dh key",
      web({
        endpoint: newWebSubscription().endpoint,
        keys: { ...keys, p256dh: keys.p256dh.slice(1) },
      }),
      "subscription.keys.p256dh: Must be 87 base64url characters",
    ],
    [
      "a long auth secret",
      web({ endpoint: newWebSubscription().endpoint, keys: { ...keys, auth: `${keys.auth}A` } }),
      "subscription.keys.auth: Must be 22 base64url characters",
    ],
  ])("refuses %s with 400 and stores nothing", async (_label, body, error) => {
    const res = await register(refusals.token, body);

    expectError(res, 400, error);
    expect(await devicesOf(refusals.userId)).toEqual([]);
  });
});

// Unsets the VAPID keys, which every request sees, so this runs on its own and restores them after.
describe("without web push configured", { concurrent: false }, () => {
  const VAPID_VARS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
  const saved = Object.fromEntries(VAPID_VARS.map((name) => [name, process.env[name]]));

  beforeAll(() => {
    for (const name of VAPID_VARS) delete process.env[name];
  });
  afterAll(() => {
    Object.assign(process.env, saved);
  });

  it("refuses a browser with 503 and stores nothing", async () => {
    const res = await register(refusals.token, {
      platform: "web",
      subscription: newWebSubscription(),
    });

    expectError(res, 503, "Web push is not configured");
    expect(await devicesOf(refusals.userId)).toEqual([]);
  });

  it("returns a null web push key", async () => {
    const res = await api.get("/push/vapid-key").set(auth(refusals.token));

    expectStatus(res, 200);
    expect(res.body.data).toEqual({ publicKey: null });
  });
});

describe("POST /devices/unregister", () => {
  it("removes only the caller's own device and always answers 200", async () => {
    const caller = await signUpByPhone("rider");
    const other = await createPhoneAccount(superAdmin.token, "driver");
    const theirs = await seedDevice(other.id, "android");
    const mine = await seedDevice(caller.userId, "web");

    for (const token of [theirs.token, newExpoToken(), mine.token, mine.token]) {
      const res = await unregister(caller.token, token);
      expectStatus(res, 200);
      expect(res.body).toEqual({
        success: true,
        message: "Device unregistered successfully",
        data: null,
      });
    }

    expect(await devicesOf(other.id)).toMatchObject([{ id: theirs.id }]);
    expect(await devicesOf(caller.userId)).toEqual([]);
    const entries = await auditEntries("device.unregister", { actorId: caller.userId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      targetId: mine.id,
      module: "notifications",
      targetType: "pushDevice",
    });
    expect(entries[0].requestBody).toEqual({ token: "[REDACTED]" });
    expect(JSON.stringify(entries[0])).not.toContain(mine.token);
  });

  it("refuses a missing token with 400", async () => {
    const res = await api.post("/devices/unregister").set(auth(refusals.token)).send({});

    expectError(res, 400, "token: Invalid input: expected string, received undefined");
  });
});

describe("GET /push/vapid-key", () => {
  it("returns the public key and nothing else", async () => {
    const res = await api.get("/push/vapid-key").set(auth(refusals.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Web push key retrieved successfully");
    expect(res.body.data).toEqual({ publicKey: process.env.VAPID_PUBLIC_KEY });
    expect(JSON.stringify(res.body)).not.toContain(process.env.VAPID_PRIVATE_KEY);
  });
});

describe("authentication", () => {
  it.each([
    ["post", "/devices"],
    ["post", "/devices/unregister"],
    ["get", "/push/vapid-key"],
  ] as const)("%s %s needs an access token", async (method, path) => {
    const missing = await api[method](path).send({ platform: "ios", token: newExpoToken() });
    expectError(missing, 401, "Missing or invalid Authorization header");

    const invalid = await api[method](path).set(auth("not-a-jwt")).send({ token: newExpoToken() });
    expectError(invalid, 401, "Invalid or expired access token");
  });
});

describe("POST /auth/logout with pushToken", () => {
  const logout = (body: object) => api.post("/auth/logout").send(body);

  it("signs the session out and removes that device, leaving the account's others", async () => {
    const user = await signUpByPhone("rider");
    const [device, other] = await Promise.all([
      seedDevice(user.userId, "ios"),
      seedDevice(user.userId, "android"),
    ]);

    const res = await logout({ refreshToken: user.refreshToken, pushToken: device.token });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Logged out successfully");
    expect(await devicesOf(user.userId)).toMatchObject([{ id: other.id }]);
    expectStatus(await api.post("/auth/refresh").send({ refreshToken: user.refreshToken }), 401);

    const [entry] = await auditEntries("auth.logout", { actorId: user.userId });
    expect(entry.requestBody).toEqual({ refreshToken: "[REDACTED]", pushToken: "[REDACTED]" });
  });

  it("leaves the devices alone without a pushToken", async () => {
    const user = await signUpByPhone("driver");
    const device = await seedDevice(user.userId, "android");

    expectStatus(await logout({ refreshToken: user.refreshToken }), 200);

    expect(await devicesOf(user.userId)).toMatchObject([{ id: device.id }]);
  });

  it("never removes another account's device", async () => {
    const user = await signUpByPhone("rider");
    const other = await createPhoneAccount(superAdmin.token, "rider");
    const theirs = await seedDevice(other.id, "ios");

    expectStatus(await logout({ refreshToken: user.refreshToken, pushToken: theirs.token }), 200);

    expect(await devicesOf(other.id)).toMatchObject([{ id: theirs.id }]);
  });

  it("removes nothing with a dead or unknown refresh token", async () => {
    const user = await signUpByPhone("rider");
    const device = await seedDevice(user.userId, "web");
    expectStatus(await logout({ refreshToken: user.refreshToken }), 200);

    for (const refreshToken of [user.refreshToken, "not-a-refresh-token"]) {
      const res = await logout({ refreshToken, pushToken: device.token });
      expectStatus(res, 200);
    }

    expect(await devicesOf(user.userId)).toMatchObject([{ id: device.id }]);
  });

  it("refuses a pushToken over 2048 characters with 400", async () => {
    const res = await logout({ refreshToken: "not-a-refresh-token", pushToken: "x".repeat(2049) });

    expectError(res, 400, "pushToken: Too big: expected string to have <=2048 characters");
  });
});

describe("docs", () => {
  it("documents both device shapes as oneOf, with the exact errors", async () => {
    const res = await api.get("/openapi.json");
    expectStatus(res, 200);
    const operation = res.body.paths["/devices"].post;
    const error = (status: number) =>
      operation.responses[status].content["application/json"].example.error;

    const shapes = operation.requestBody.content["application/json"].schema.oneOf;
    expect(
      shapes.map(
        (shape: { properties: { platform: { enum: string[] } } }) => shape.properties.platform.enum,
      ),
    ).toEqual([["ios", "android"], ["web"]]);
    expect(error(400)).toBe("token: Must be an Expo push token, e.g. ExponentPushToken[...]");
    expect(error(503)).toBe("Web push is not configured");
    expect(
      res.body.paths["/auth/logout"].post.requestBody.content["application/json"].schema.properties,
    ).toHaveProperty("pushToken");
  });
});

describe("logging", () => {
  it("blanks push tokens, subscriptions and refresh tokens in logged request bodies", () => {
    const subscription = newWebSubscription();
    const cases = [
      [
        "POST",
        "/devices",
        { platform: "ios", token: "ExponentPushToken[abc]" },
        { platform: "ios", token: "[REDACTED]" },
      ],
      [
        "POST",
        "/devices",
        { platform: "web", subscription },
        { platform: "web", subscription: "[REDACTED]" },
      ],
      ["POST", "/devices/unregister", { token: subscription.endpoint }, { token: "[REDACTED]" }],
      [
        "POST",
        "/auth/logout",
        { refreshToken: "r", pushToken: "p" },
        { refreshToken: "[REDACTED]", pushToken: "[REDACTED]" },
      ],
      ["POST", "/auth/logout", { refreshToken: "r" }, { refreshToken: "[REDACTED]" }],
      ["POST", "/auth/refresh", { refreshToken: "r" }, { refreshToken: "[REDACTED]" }],
    ] as const;

    for (const [method, originalUrl, body, logged] of cases) {
      expect(loggableBody({ method, originalUrl, body }), originalUrl).toEqual(logged);
    }
    // The request's own body is never changed, and other routes' bodies pass through as they are.
    const sent = { refreshToken: "r", pushToken: "p" };
    loggableBody({ method: "POST", originalUrl: "/auth/logout", body: sent });
    expect(sent).toEqual({ refreshToken: "r", pushToken: "p" });
    const other = { fullName: "Ama Mensah" };
    expect(loggableBody({ method: "PATCH", originalUrl: "/users/1", body: other })).toBe(other);
  });

  it("blanks the token pair in logged responses of the auth routes that sign in", () => {
    const signedIn = (data: object) => ({ success: true, message: "Login successful", data });
    const tokens = { accessToken: "eyJhbGciOiJIUzI1NiJ9.a.b", refreshToken: "q3J8b1xN0pZ4" };
    const blanked = { accessToken: "[REDACTED]", refreshToken: "[REDACTED]" };

    for (const path of [
      "/auth/login",
      "/auth/login/verify",
      "/auth/refresh",
      "/auth/password/change",
    ]) {
      const body = signedIn({ ...tokens, user: { id: "u1" }, isNewUser: false });
      expect(loggableResponse(body, path), path).toEqual(
        signedIn({ ...blanked, user: { id: "u1" }, isNewUser: false }),
      );
      expect(body.data).toMatchObject(tokens); // the response itself is never changed
    }

    // Other routes, and the one-argument call, are left as they were (boarding codes are still blanked).
    const elsewhere = signedIn(tokens);
    expect(loggableResponse(elsewhere, "/users/u1")).toBe(elsewhere);
    expect(loggableResponse(elsewhere)).toBe(elsewhere);
    expect(loggableResponse(signedIn({ boardingCode: "TR-7KQ2MX" }), "/trips/t1")).toEqual(
      signedIn({ boardingCode: "[REDACTED]" }),
    );
    expect(loggableResponse(undefined, "/auth/login")).toBeUndefined();
  });
});
