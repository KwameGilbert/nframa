import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import * as data from "./helpers/data.js";
import { newVehicle } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let supportAgent: Awaited<ReturnType<typeof createSignedInAdmin>>; // users: read
let otherDriver: Awaited<ReturnType<typeof signUpByPhone>>;

// A signed-up driver with one registered vehicle.
async function driverWithVehicle() {
  const driver = await signUpByPhone("driver");
  const res = await api
    .post("/vehicles")
    .set(auth(driver.token))
    .send(await newVehicle(driver.userId));
  expectStatus(res, 201);
  trackForCleanup("vehicles", { id: res.body.data.id });
  return { driver, vehicle: res.body.data };
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [supportAgent, otherDriver] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    signUpByPhone("driver"),
  ]);
});

describe("POST /vehicles", () => {
  it("lets a driver register their own vehicle", async () => {
    const driver = await signUpByPhone("driver");
    const vehicle = await newVehicle(driver.userId);

    const res = await api.post("/vehicles").set(auth(driver.token)).send(vehicle);

    expectStatus(res, 201);
    trackForCleanup("vehicles", { id: res.body.data.id });
    expect(res.body.message).toBe("Vehicle created successfully");
    expect(res.body.data).toMatchObject({
      ...vehicle,
      status: "active",
      isVerified: false,
      verificationDate: null,
    });
  });

  it("keeps plate numbers unique", async () => {
    const { driver, vehicle } = await driverWithVehicle();

    const res = await api
      .post("/vehicles")
      .set(auth(driver.token))
      .send({ ...(await newVehicle(driver.userId)), plate: vehicle.plate });

    expectStatus(res, 409);
  });

  it("doesn't let a driver register a vehicle for someone else", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post("/vehicles")
      .set(auth(otherDriver.token))
      .send(data.vehicle(driver.userId));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on users");
  });

  it("lets an admin with users: create register a vehicle for a driver", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post("/vehicles")
      .set(auth(superAdmin.token))
      .send(await newVehicle(driver.userId));

    expectStatus(res, 201);
    trackForCleanup("vehicles", { id: res.body.data.id });
  });

  it("needs at least one seat", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post("/vehicles")
      .set(auth(driver.token))
      .send({ ...data.vehicle(driver.userId), seats: 0 });

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^seats:/);
  });
});

describe("GET /vehicles/:id", () => {
  it("lets the owner read their vehicle", async () => {
    const { driver, vehicle } = await driverWithVehicle();

    const res = await api.get(`/vehicles/${vehicle.id}`).set(auth(driver.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Vehicle retrieved successfully");
    expect(res.body.data).toMatchObject({ id: vehicle.id, plate: vehicle.plate });
  });

  it("lets an admin with users: read view any vehicle", async () => {
    const { vehicle } = await driverWithVehicle();

    const res = await api.get(`/vehicles/${vehicle.id}`).set(auth(supportAgent.token));

    expectStatus(res, 200);
  });

  it("doesn't let another driver view it", async () => {
    const { vehicle } = await driverWithVehicle();

    const res = await api.get(`/vehicles/${vehicle.id}`).set(auth(otherDriver.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on users");
  });

  it("returns 404 for an unknown vehicle", async () => {
    const id = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

    const res = await api.get(`/vehicles/${id}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Vehicle not found: ${id}`);
  });
});

describe("PATCH /vehicles/:id", () => {
  it("lets the owner update their vehicle", async () => {
    const { driver, vehicle } = await driverWithVehicle();
    const color = data.otherColor(vehicle.color);

    const res = await api.patch(`/vehicles/${vehicle.id}`).set(auth(driver.token)).send({ color });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Vehicle updated successfully");
    expect(res.body.data.color).toBe(color);
  });

  it("doesn't let another driver update it", async () => {
    const { vehicle } = await driverWithVehicle();

    const res = await api
      .patch(`/vehicles/${vehicle.id}`)
      .set(auth(otherDriver.token))
      .send({ color: data.otherColor(vehicle.color) });

    expectStatus(res, 403);
  });

  it("needs users: update for an admin to change it", async () => {
    const { vehicle } = await driverWithVehicle();

    const res = await api
      .patch(`/vehicles/${vehicle.id}`)
      .set(auth(supportAgent.token))
      .send({ seats: 4 });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on users");
  });

  it("won't take a plate number that's already registered", async () => {
    const [first, second] = await Promise.all([driverWithVehicle(), driverWithVehicle()]);

    const res = await api
      .patch(`/vehicles/${second.vehicle.id}`)
      .set(auth(second.driver.token))
      .send({ plate: first.vehicle.plate });

    expectStatus(res, 409);
  });

  it("rejects an empty update", async () => {
    const { driver, vehicle } = await driverWithVehicle();

    const res = await api.patch(`/vehicles/${vehicle.id}`).set(auth(driver.token)).send({});

    expectStatus(res, 400);
  });
});
