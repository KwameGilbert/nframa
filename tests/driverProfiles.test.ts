import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createPhoneAccount,
  createSignedInAdmin,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { trackForCleanup } from "./helpers/cleanup.js";

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
  trackForCleanup("carOwnerProfiles", { userId: driver.userId });
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
    trackForCleanup("carOwnerProfiles", { userId: driver.userId });
    expect(res.body.message).toBe("Driver profile created successfully");
    expect(res.body.data.driver).toMatchObject({
      userId: driver.userId,
      ghanaCardNumber,
      address,
      verificationStatus: "unverified",
      isOnline: false,
      autoAcceptBookings: false,
      vehicles: [],
      documents: [],
    });
    expect(res.body.data.driver.user).toMatchObject({ id: driver.userId, role: "driver" });
    expect(res.body.data.driver.code).toMatch(/^DR-[A-HJ-NP-Z2-9]{6}$/);
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
    trackForCleanup("carOwnerProfiles", { userId: driver.id });
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
    expect(res.body.data.driver.userId).toBe(driver.userId);
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

describe("GET /drivers", () => {
  it("lists every driver with their user, vehicles and documents", async () => {
    const driver = await driverWithProfile();

    const res = await api.get("/drivers").set(auth(supportAgent.token));

    expectStatus(res, 200);
    const found = res.body.data.find(
      (d: { driver: { userId: string } }) => d.driver.userId === driver.userId,
    );
    expect(found.driver).toMatchObject({ userId: driver.userId, vehicles: [], documents: [] });
    expect(found.driver.user.id).toBe(driver.userId);
  });

  it("needs users: read", async () => {
    const res = await api.get("/drivers").set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });
});

describe("GET /drivers/code/:code", () => {
  it("finds a driver by their code", async () => {
    const driver = await driverWithProfile();
    const created = await api.get(`/driver/${driver.userId}`).set(auth(supportAgent.token));

    const res = await api
      .get(`/drivers/code/${created.body.data.driver.code}`)
      .set(auth(supportAgent.token));

    expectStatus(res, 200);
    expect(res.body.data.driver.userId).toBe(driver.userId);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await api.get("/drivers/code/DR-000000").set(auth(supportAgent.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe("Driver not found with code: DR-000000");
  });

  it("needs users: read", async () => {
    const res = await api.get("/drivers/code/DR-000000").set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });
});

describe("GET /drivers/phone/:phoneCountryCode/:phoneNumber", () => {
  it("finds a driver by their phone number", async () => {
    const driver = await driverWithProfile();

    const res = await api
      .get(`/drivers/phone/${driver.phoneCountryCode}/${driver.phoneNumber}`)
      .set(auth(supportAgent.token));

    expectStatus(res, 200);
    expect(res.body.data.driver.userId).toBe(driver.userId);
  });

  it("returns 404 for an unknown phone number", async () => {
    const res = await api.get("/drivers/phone/+233/000000000").set(auth(supportAgent.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe("Driver not found with phone: +233000000000");
  });

  it("needs users: read", async () => {
    const res = await api.get("/drivers/phone/+233/000000000").set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
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
    expect(res.body.data.driver).toMatchObject({ isOnline: true, autoAcceptBookings: true });
  });

  it("lets a driver update their address", async () => {
    const driver = await driverWithProfile();
    const address = data.address();

    const res = await api
      .patch(`/driver/${driver.userId}`)
      .set(auth(driver.token))
      .send({ address });

    expectStatus(res, 200);
    expect(res.body.data.driver.address).toBe(address);
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
