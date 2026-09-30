import { describe, expect, it, vi } from "vitest";
import { settingModel } from "../src/models/setting.model.js";
import { TRIP_SETTINGS, type TripSettingSpec } from "../src/config/tripSettings.js";
import db from "../src/database/knex.js";

// The seeded rows can't be edited by tests, so the stored rows are stubbed at the query. Sequential: the
// stub is on the shared model.
function withStoredRows<T>(rows: { key: string; value: unknown }[], run: () => Promise<T>) {
  const stub = vi
    .spyOn(settingModel as unknown as { table: unknown }, "table", "get")
    .mockReturnValue({
      whereIn: () => ({ select: async () => rows }),
    } as never);
  return run().finally(() => stub.mockRestore());
}

describe("settingModel.getValue / getValues", { concurrent: false }, () => {
  it("returns the stored value when present and valid", async () => {
    const value = await withStoredRows([{ key: "fares.baseFare", value: 7.5 }], () =>
      settingModel.getValue("fares.baseFare"),
    );

    expect(value).toBe(7.5);
  });

  it("returns the default when the setting is missing", async () => {
    const value = await withStoredRows([], () => settingModel.getValue("fares.perKmRate"));

    expect(value).toBe(TRIP_SETTINGS["fares.perKmRate"].default);
  });

  it("returns the default when the stored value has the wrong type", async () => {
    const values = await withStoredRows(
      [
        { key: "fares.baseFare", value: "free" },
        { key: "fees.platformFeeType", value: 12 },
        { key: "trips.routeToleranceKm", value: 3 },
      ],
      () =>
        settingModel.getValues([
          "fares.baseFare",
          "fees.platformFeeType",
          "trips.routeToleranceKm",
        ]),
    );

    expect(values).toEqual({
      "fares.baseFare": 5,
      "fees.platformFeeType": "percent",
      "trips.routeToleranceKm": 3,
    });
  });
});

describe.each([
  ["an unknown fee type", "fees.platformFeeType", "percentage", "percent"],
  ["an unknown booking fee type", "fees.bookingFeeType", "flat", "fixed"],
  ["a zero fallback speed", "trips.fallbackSpeedKmh", 0, 30],
  ["a negative fallback speed", "trips.fallbackSpeedKmh", -10, 30],
  ["a negative rate", "fares.perKmRate", -2, 2],
  ["a top-up limit over its max", "wallet.maxTopUp", 5_000_000, 5000],
] as const)("settingModel.getValue with %s", { concurrent: false }, (_name, key, bad, fallback) => {
  it("falls back to the default", async () => {
    expect(await withStoredRows([{ key, value: bad }], () => settingModel.getValue(key))).toBe(
      fallback,
    );
  });
});

describe("trip setting defaults", () => {
  it("are valid for every setting's type and bounds", () => {
    for (const spec of Object.values(TRIP_SETTINGS) as TripSettingSpec[]) {
      expect(typeof spec.default).toBe(spec.type);
      if (spec.min !== undefined) expect(spec.default as number).toBeGreaterThanOrEqual(spec.min);
      if (spec.max !== undefined) expect(spec.default as number).toBeLessThanOrEqual(spec.max);
      if (spec.oneOf) expect(spec.oneOf).toContain(spec.default);
    }
  });
});

describe("settingModel.getValues against the database", () => {
  it("reads every trip setting in one query, each valid for its type", async () => {
    const keys = Object.keys(TRIP_SETTINGS) as (keyof typeof TRIP_SETTINGS)[];
    const queries: string[] = [];
    const onQuery = (q: { sql: string }) => queries.push(q.sql);
    db.on("query", onQuery);

    const values = await settingModel.getValues(keys);

    db.removeListener("query", onQuery);
    expect(Object.keys(values).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(typeof values[key]).toBe(TRIP_SETTINGS[key].type);
    }
    expect(queries.filter((sql) => sql.includes('"settings"'))).toHaveLength(1);
  });
});
