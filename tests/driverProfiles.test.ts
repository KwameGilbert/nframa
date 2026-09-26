import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createPhoneAccount,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let supportAgent: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read
let rider: Awaited<ReturnType<typeof signUpByPhone>>;

// A signed-up driver who has already created their profile.
async function driverWithProfile() {
  const driver = await signUpByPhone("driver");
  const res = await api.post("/driver").set(auth(driver.token)).send({
    userId: driver.userId,
    ghanaCardNumber: data.ghanaCardNumber(),
    address: data.address(),
  });
  expectStatus(res, 201);
  return driver;
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [supportAgent, rider] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    signUpByPhone("rider"),
  ]);
});

describe("POST /driver", () => {
  it("lets a driver create their own profile, with a generated driver code", async () => {
    const driver = await signUpByPhone("driver");
    const ghanaCardNumber = data.ghanaCardNumber();
    const address = data.address();

    const res = await api
      .post("/driver")
      .set(auth(driver.token))
      .send({ userId: driver.userId, ghanaCardNumber, address });

    expectStatus(res, 201);
    expect(res.body.message).toBe("Driver profile created successfully");
    expect(res.body.data).toMatchObject({
      userId: driver.userId,
      ghanaCardNumber,
      address,
      verificationStatus: "unverified",
      isOnline: false,
      autoAcceptBookings: false,
    });
    expect(res.body.data.code).toMatch(/^DR-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("allows one profile per driver", async () => {
    const driver = await driverWithProfile();

    const res = await api.post("/driver").set(auth(driver.token)).send({ userId: driver.userId });

    expectStatus(res, 409);
  });

  it("lets an admin with users: create set up a driver's profile", async () => {
    const driver = await createPhoneAccount(superAdmin.token, "driver");

    const res = await api
      .post("/driver")
      .set(auth(superAdmin.token))
      .send({ userId: driver.id, address: data.address() });

    expectStatus(res, 201);
  });

  it("doesn't let a rider create a profile for someone else", async () => {
    const driver = await createPhoneAccount(superAdmin.token, "driver");

    const res = await api.post("/driver").set(auth(rider.token)).send({ userId: driver.id });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on users");
  });

  it("rejects a user id that isn't a UUID", async () => {
    const res = await api.post("/driver").set(auth(superAdmin.token)).send({ userId: "DR-7KQ2MX" });

    expectStatus(res, 400);
  });
});

describe("GET /driver/:userId", () => {
  it("lets a driver read their own profile", async () => {
    const driver = await driverWithProfile();

    const res = await api.get(`/driver/${driver.userId}`).set(auth(driver.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Driver profile retrieved successfully");
    expect(res.body.data.userId).toBe(driver.userId);
  });

  it("lets an admin with users: read view any driver's profile", async () => {
    const driver = await driverWithProfile();

    const res = await api.get(`/driver/${driver.userId}`).set(auth(supportAgent.token));

    expectStatus(res, 200);
  });

  it("doesn't let a rider view a driver's profile", async () => {
    const driver = await driverWithProfile();

    const res = await api.get(`/driver/${driver.userId}`).set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });

  it("returns 404 for a user with no driver profile", async () => {
    const res = await api.get(`/driver/${rider.userId}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Driver profile not found for user: ${rider.userId}`);
  });
});

describe("PATCH /driver/:userId", () => {
  it("lets a driver go online and turn on auto-accept", async () => {
    const driver = await driverWithProfile();

    const res = await api
      .patch(`/driver/${driver.userId}`)
      .set(auth(driver.token))
      .send({ isOnline: true, autoAcceptBookings: true });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Driver profile updated successfully");
    expect(res.body.data).toMatchObject({ isOnline: true, autoAcceptBookings: true });
  });

  it("lets a driver update their address", async () => {
    const driver = await driverWithProfile();
    const address = data.address();

    const res = await api
      .patch(`/driver/${driver.userId}`)
      .set(auth(driver.token))
      .send({ address });

    expectStatus(res, 200);
    expect(res.body.data.address).toBe(address);
  });

  it("needs users: update to change someone else's profile", async () => {
    const driver = await driverWithProfile();

    const res = await api
      .patch(`/driver/${driver.userId}`)
      .set(auth(supportAgent.token))
      .send({ isOnline: false });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on users");
  });

  it("rejects an empty update", async () => {
    const driver = await driverWithProfile();

    const res = await api.patch(`/driver/${driver.userId}`).set(auth(driver.token)).send({});

    expectStatus(res, 400);
  });

  it("returns 404 for a user with no driver profile", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .patch(`/driver/${driver.userId}`)
      .set(auth(driver.token))
      .send({ isOnline: true });

    expectStatus(res, 404);
  });
});
