import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createPhoneAccount,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let supportAgent: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read

// A signed-up rider who has already created their profile.
async function riderWithProfile() {
  const rider = await signUpByPhone("rider");
  expectStatus(await api.post("/rider").set(auth(rider.token)).send({ userId: rider.userId }), 201);
  trackForCleanup("riderProfiles", { userId: rider.userId });
  return rider;
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  supportAgent = await createSignedInAdmin(superAdmin.token, { users: { read: true } });
});

describe("POST /rider", () => {
  it("lets a rider create their own profile", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.post("/rider").set(auth(rider.token)).send({ userId: rider.userId });

    expectStatus(res, 201);
    trackForCleanup("riderProfiles", { userId: rider.userId });
    expect(res.body.message).toBe("Rider profile created successfully");
    expect(res.body.data.userId).toBe(rider.userId);
    expect(Date.parse(res.body.data.createdAt)).not.toBeNaN();
  });

  it("allows one profile per rider", async () => {
    const rider = await riderWithProfile();

    const res = await api.post("/rider").set(auth(rider.token)).send({ userId: rider.userId });

    expectStatus(res, 409);
  });

  it("lets an admin with users: create set up a rider's profile", async () => {
    const rider = await createPhoneAccount(superAdmin.token, "rider");

    const res = await api.post("/rider").set(auth(superAdmin.token)).send({ userId: rider.id });

    expectStatus(res, 201);
    trackForCleanup("riderProfiles", { userId: rider.id });
  });

  it("doesn't let a rider create a profile for someone else", async () => {
    const [rider, other] = await Promise.all([
      signUpByPhone("rider"),
      createPhoneAccount(superAdmin.token, "rider"),
    ]);

    const res = await api.post("/rider").set(auth(rider.token)).send({ userId: other.id });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on users");
  });

  it("needs a signed-in user", async () => {
    const res = await api.post("/rider").send({ userId: "4a6c8e0f-1b3d-4f5a-9c7e-2d4f6a8b0c1e" });

    expectStatus(res, 401);
  });
});

describe("GET /rider/:userId", () => {
  it("lets a rider read their own profile", async () => {
    const rider = await riderWithProfile();

    const res = await api.get(`/rider/${rider.userId}`).set(auth(rider.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Rider profile retrieved successfully");
    expect(res.body.data.userId).toBe(rider.userId);
  });

  it("lets an admin with users: read view any rider's profile", async () => {
    const rider = await riderWithProfile();

    const res = await api.get(`/rider/${rider.userId}`).set(auth(supportAgent.token));

    expectStatus(res, 200);
  });

  it("doesn't let one rider view another's profile", async () => {
    const [rider, other] = await Promise.all([riderWithProfile(), signUpByPhone("rider")]);

    const res = await api.get(`/rider/${rider.userId}`).set(auth(other.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });

  it("returns 404 for a user with no rider profile", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.get(`/rider/${rider.userId}`).set(auth(rider.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Rider profile not found for user: ${rider.userId}`);
  });

  it("returns 400 for an id that isn't a UUID", async () => {
    const res = await api.get("/rider/ama-serwaa").set(auth(superAdmin.token));

    expectStatus(res, 400);
  });
});
