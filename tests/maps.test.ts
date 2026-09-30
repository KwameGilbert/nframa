import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRoute } from "../src/services/maps.service.js";
import { getGoogleRoute } from "../src/services/google.service.js";
import { haversineMeters } from "../src/services/geo.js";
import { settingModel } from "../src/models/setting.model.js";

// Everything here changes process-wide state (the API key, the Google mock, fetch), so it all runs in order.
const origin = { lat: 5.6224, lng: -0.1737 };
const destination = { lat: 5.556, lng: -0.182 };
const straightLine = Math.round(haversineMeters(origin, destination));

describe("getRoute", { concurrent: false }, () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const googleMock = vi.mocked(getGoogleRoute);

  beforeEach(() => {
    googleMock.mockClear();
    vi.spyOn(settingModel, "getValue").mockResolvedValue(30);
  });

  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = key;
    vi.mocked(settingModel.getValue).mockRestore();
  });

  it("uses Google when the key is set and the call works", async () => {
    googleMock.mockResolvedValueOnce({ distanceMeters: 9000, durationSeconds: 1000 });

    expect(await getRoute(origin, destination)).toEqual({
      distanceMeters: 9000,
      durationSeconds: 1000,
      source: "google",
    });
  });

  it("falls back to straight-line distance at the fallback speed when Google throws", async () => {
    googleMock.mockRejectedValueOnce(new Error("boom"));

    const route = await getRoute(origin, destination);

    expect(route.source).toBe("haversine");
    expect(route.distanceMeters).toBe(straightLine);
    // 30 km/h is 500 m per minute.
    expect(route.durationSeconds).toBe(Math.round((straightLine / 500) * 60));
  });

  it("goes straight to the fallback, without calling Google, when there's no key", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const route = await getRoute(origin, destination);

    expect(googleMock).not.toHaveBeenCalled();
    expect(route).toMatchObject({ distanceMeters: straightLine, source: "haversine" });
  });
});

describe("getGoogleRoute", { concurrent: false }, () => {
  async function actual() {
    return (
      await vi.importActual<typeof import("../src/services/google.service.js")>(
        "../src/services/google.service.js",
      )
    ).getGoogleRoute;
  }

  function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, ...response }) as Response);
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Directions for a driving route and reads distance and duration from the first leg", async () => {
    const fetchStub = stubFetch({
      json: async () => ({
        status: "OK",
        routes: [{ legs: [{ distance: { value: 8123 }, duration: { value: 1010 } }] }],
      }),
    });

    const route = await (await actual())(origin, destination);

    expect(route).toEqual({ distanceMeters: 8123, durationSeconds: 1010 });
    const url = String((fetchStub.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("origin=5.6224%2C-0.1737");
    expect(url).toContain("destination=5.556%2C-0.182");
    expect(url).toContain("mode=driving");
    expect(url).toContain("key=test-google-key");
  });

  it("throws on a non-2xx response", async () => {
    stubFetch({ ok: false, status: 503 });

    await expect((await actual())(origin, destination)).rejects.toThrow("503");
  });

  it.each([
    ["a status other than OK", { status: "REQUEST_DENIED", error_message: "bad key", routes: [] }],
    ["no routes", { status: "OK", routes: [] }],
    ["ZERO_RESULTS", { status: "ZERO_RESULTS" }],
  ])("throws on %s", async (_name, body) => {
    stubFetch({ json: async () => body });

    await expect((await actual())(origin, destination)).rejects.toThrow("Google Directions");
  });

  it("propagates a network failure or timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    await expect((await actual())(origin, destination)).rejects.toThrow("timeout");
  });
});
