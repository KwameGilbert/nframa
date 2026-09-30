import { beforeAll, describe, expect, it, vi } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { calculateFare, getFareSettings, roundMoney } from "../src/services/fare.service.js";
import { settingModel } from "../src/models/setting.model.js";
import { haversineMeters } from "../src/services/geo.js";

const settings = {
  "fares.baseFare": 5,
  "fares.perKmRate": 2,
  "fares.perMinuteRate": 0.5,
  "fares.waitPerMinuteRate": 0.5,
  "fares.waitGraceMinutes": 5,
  "fees.platformFeeType": "percent",
  "fees.platformFeeValue": 10,
  "fees.bookingFeeType": "fixed",
  "fees.bookingFeeValue": 1,
};

describe("calculateFare", () => {
  it("adds base, distance and time, then a percent platform fee and fixed booking fee on top", () => {
    // 10 km and 20 min: 5 + 20 + 10 = 35 fare, 3.5 platform fee, 1 booking fee.
    expect(calculateFare({ distanceMeters: 10_000, durationSeconds: 1200 }, settings)).toEqual({
      currency: "GHS",
      base: 5,
      distance: 20,
      time: 10,
      wait: 0,
      fare: 35,
      platformFee: 3.5,
      bookingFee: 1,
      total: 39.5,
      driverEarnings: 35,
    });
  });

  it("supports a fixed platform fee and a percent booking fee", () => {
    const fare = calculateFare(
      { distanceMeters: 10_000, durationSeconds: 1200 },
      {
        ...settings,
        "fees.platformFeeType": "fixed",
        "fees.platformFeeValue": 2.5,
        "fees.bookingFeeType": "percent",
        "fees.bookingFeeValue": 4,
      },
    );

    expect(fare).toMatchObject({
      platformFee: 2.5,
      bookingFee: 1.4,
      total: 38.9,
      driverEarnings: 35,
    });
  });

  it("doesn't charge wait time inside the grace period, or exactly at it", () => {
    const leg = { distanceMeters: 0, durationSeconds: 0 };

    expect(calculateFare({ ...leg, waitMinutes: 3 }, settings).wait).toBe(0);
    expect(calculateFare({ ...leg, waitMinutes: 5 }, settings).wait).toBe(0);
  });

  it("charges only the wait past the grace period, and it counts towards the fare", () => {
    const fare = calculateFare({ distanceMeters: 0, durationSeconds: 0, waitMinutes: 9 }, settings);

    // 4 chargeable minutes x 0.5 = 2; fare 5 + 2 = 7.
    expect(fare).toMatchObject({ wait: 2, fare: 7, driverEarnings: 7 });
  });

  it("rounds every money value to 2 decimals", () => {
    const fare = calculateFare(
      { distanceMeters: 3333, durationSeconds: 555 },
      { ...settings, "fares.perKmRate": 1.999, "fees.platformFeeValue": 7.5 },
    );

    for (const [name, value] of Object.entries(fare)) {
      if (typeof value === "number") {
        expect(value, name).toBe(roundMoney(value));
      }
    }
    expect(fare.total).toBe(roundMoney(fare.fare + fare.platformFee + fare.bookingFee));
  });

  it("rounds half a cent up", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });
});

describe("POST /fares/estimate", () => {
  const pickup = { lat: 5.6224, lng: -0.1737 };
  const dropoff = { lat: 5.556, lng: -0.182 };
  let rider: Awaited<ReturnType<typeof signUpByPhone>>;

  beforeAll(async () => {
    await loginAsSuperAdmin();
    rider = await signUpByPhone("rider");
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.post("/fares/estimate").send({ pickup, dropoff }), 401);
  });

  it.each([
    ["no pickup", { dropoff }],
    ["a latitude past 90", { pickup: { lat: 91, lng: 0 }, dropoff }],
    ["a longitude past 180", { pickup, dropoff: { lat: 0, lng: 181 } }],
    ["a text coordinate", { pickup: { lat: "5.6", lng: 0 }, dropoff }],
    ["negative wait minutes", { pickup, dropoff, waitMinutes: -1 }],
  ])("rejects %s", async (_name, body) => {
    expectStatus(await api.post("/fares/estimate").set(auth(rider.token)).send(body), 400);
  });

  it("estimates the trip from the stored (or default) settings, for any signed-in user", async () => {
    const res = await api.post("/fares/estimate").set(auth(rider.token)).send({ pickup, dropoff });

    expectStatus(res, 200);
    const { distanceMeters, durationSeconds, routeSource, currency, breakdown } = res.body.data;
    expect(res.body.message).toBe("Fare estimated successfully");
    // The global Google mock: 1.3x the straight line at 10 m/s.
    expect(routeSource).toBe("google");
    expect(distanceMeters).toBe(Math.round(haversineMeters(pickup, dropoff) * 1.3));
    expect(durationSeconds).toBe(Math.round(distanceMeters / 10));
    expect(currency).toBe("GHS");
    const expected = calculateFare({ distanceMeters, durationSeconds }, await getFareSettings());
    expect({ ...breakdown, currency }).toEqual(expected);
  });
});

// Stubs the settings the endpoint reads, so it's sequential: the stub is visible to every request.
describe("POST /fares/estimate with known settings", { concurrent: false }, () => {
  it("uses them, including the wait past the grace period", async () => {
    const rider = await signUpByPhone("rider");
    const spy = vi
      .spyOn(settingModel, "getValues")
      .mockImplementation((async () => settings) as never);

    try {
      const res = await api
        .post("/fares/estimate")
        .set(auth(rider.token))
        .send({ pickup: { lat: 0, lng: 0 }, dropoff: { lat: 0, lng: 0.1 }, waitMinutes: 9 });

      expectStatus(res, 200);
      const { distanceMeters, durationSeconds, breakdown } = res.body.data;
      const km = distanceMeters / 1000;
      const fare = roundMoney(5 + km * 2 + (durationSeconds / 60) * 0.5 + 2);
      expect(breakdown).toMatchObject({
        base: 5,
        wait: 2,
        fare,
        platformFee: roundMoney(fare * 0.1),
        bookingFee: 1,
        total: roundMoney(fare + roundMoney(fare * 0.1) + 1),
        driverEarnings: fare,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
