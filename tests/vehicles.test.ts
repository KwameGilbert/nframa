import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../src/database/knex.js";
import { VEHICLE_PHOTO_SIDES } from "../src/schemas/vehicle.schema.js";
import { deleteFile, uploadFile } from "../src/services/storage.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { postVehicle } from "./helpers/vehicles.js";
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
  const res = await postVehicle(driver.token, await newVehicle(driver.userId));
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
  it("lets a driver register their own vehicle with a photo of each side", async () => {
    const driver = await signUpByPhone("driver");
    const vehicle = await newVehicle(driver.userId);

    const res = await postVehicle(driver.token, vehicle);

    expectStatus(res, 201);
    trackForCleanup("vehicles", { id: res.body.data.id });
    expect(res.body.message).toBe("Vehicle created successfully");
    expect(res.body.data).toMatchObject({
      ...vehicle,
      status: "active",
      isVerified: false,
      verificationDate: null,
    });
    for (const side of VEHICLE_PHOTO_SIDES) {
      expect(res.body.data.photos[side]).toContain(`vehicles/${res.body.data.id}/`);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/photoKeys|storageKey/);
    const row = await db("vehicles").where({ id: res.body.data.id }).first();
    expect(Object.keys(row.photoKeys).sort()).toEqual([...VEHICLE_PHOTO_SIDES].sort());
  });

  it("needs all four photos, sent as multipart", async () => {
    const driver = await signUpByPhone("driver");
    const details = await newVehicle(driver.userId);

    const partial = await postVehicle(driver.token, details, ["front", "back"]);
    expectError(partial, 400, "Add a photo of each side of the vehicle; missing: left, right");
    const json = await api.post("/vehicles").set(auth(driver.token)).send(details);
    expectError(
      json,
      400,
      "Add a photo of each side of the vehicle; missing: front, back, left, right",
    );
    const extra = await postVehicle(driver.token, details).attach("roof", Buffer.from("x"), {
      filename: "roof.jpg",
      contentType: "image/jpeg",
    });
    expectError(extra, 400, "Send one image under each of front, back, left, right");
    expect(vi.mocked(uploadFile)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "roof.jpg",
    );
  });

  it("keeps plate numbers unique, deleting the photos it stored", async () => {
    const { driver, vehicle } = await driverWithVehicle();
    vi.mocked(deleteFile).mockClear();

    const res = await postVehicle(driver.token, {
      ...(await newVehicle(driver.userId)),
      plate: vehicle.plate,
    });

    expectStatus(res, 409);
    expect(vi.mocked(deleteFile)).toHaveBeenCalledTimes(4);
  });

  it("doesn't let a driver register a vehicle for someone else", async () => {
    const driver = await signUpByPhone("driver");

    const res = await postVehicle(otherDriver.token, data.vehicle(driver.userId));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on users");
  });

  it("lets an admin with users: create register a vehicle for a driver", async () => {
    const driver = await signUpByPhone("driver");

    const res = await postVehicle(superAdmin.token, await newVehicle(driver.userId));

    expectStatus(res, 201);
    trackForCleanup("vehicles", { id: res.body.data.id });
  });

  it("needs at least one seat", async () => {
    const driver = await signUpByPhone("driver");

    const res = await postVehicle(driver.token, { ...data.vehicle(driver.userId), seats: 0 });

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^seats:/);
  });
});

describe("PUT /vehicles/:id/photos/:side", () => {
  const replace = (token: string, id: string, side: string) =>
    api
      .put(`/vehicles/${id}/photos/${side}`)
      .set(auth(token))
      .attach("photo", Buffer.from("new photo"), {
        filename: "new-left.jpg",
        contentType: "image/jpeg",
      });

  it("swaps one side's photo and deletes the old file", async () => {
    const { driver, vehicle } = await driverWithVehicle();
    const [before] = await db("vehicles").where({ id: vehicle.id }).select("photoKeys");
    vi.mocked(deleteFile).mockClear();

    const res = await replace(driver.token, vehicle.id, "left");

    expectStatus(res, 200);
    expect(res.body.data.photos.left).toContain("new-left.jpg");
    expect(res.body.data.photos.front).toBe(vehicle.photos.front);
    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(before.photoKeys.left);
  });

  it("refuses someone else's vehicle, an unknown side, and a missing photo", async () => {
    const { driver, vehicle } = await driverWithVehicle();
    expectStatus(await replace(otherDriver.token, vehicle.id, "left"), 403);
    expectStatus(await replace(driver.token, vehicle.id, "roof"), 400);
    expectError(
      await api.put(`/vehicles/${vehicle.id}/photos/left`).set(auth(driver.token)),
      400,
      "Send the new photo as multipart/form-data under the 'photo' field",
    );
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
