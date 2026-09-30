import { describe, expect, it } from "vitest";
import { distanceToSegmentMeters, haversineMeters, progressAlong } from "../src/services/geo.js";

// On the equator 0.02 degrees of longitude is about 2,224 m, and 0.005 degrees of latitude about 556 m.
const start = { lat: 0, lng: 0 };
const end = { lat: 0, lng: 0.02 };

describe("haversineMeters", () => {
  it("is 0 for the same point", () => {
    expect(haversineMeters(start, start)).toBe(0);
  });

  it("measures a degree of latitude as about 111.2 km", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });

  it("is the same in both directions, and right for Accra Mall to Oxford Street", () => {
    const accraMall = { lat: 5.6224, lng: -0.1737 };
    const osu = { lat: 5.556, lng: -0.182 };

    expect(haversineMeters(accraMall, osu)).toBe(haversineMeters(osu, accraMall));
    expect(haversineMeters(accraMall, osu)).toBeGreaterThan(7300);
    expect(haversineMeters(accraMall, osu)).toBeLessThan(7500);
  });
});

describe("progressAlong", () => {
  it("is 0 at the start, 1 at the end, and 0.5 halfway", () => {
    expect(progressAlong(start, start, end)).toBe(0);
    expect(progressAlong(end, start, end)).toBe(1);
    expect(progressAlong({ lat: 0, lng: 0.01 }, start, end)).toBeCloseTo(0.5, 5);
  });

  it("projects a point off the line onto it", () => {
    expect(progressAlong({ lat: 0.005, lng: 0.005 }, start, end)).toBeCloseTo(0.25, 5);
  });

  it("clamps points beyond either end", () => {
    expect(progressAlong({ lat: 0, lng: -0.01 }, start, end)).toBe(0);
    expect(progressAlong({ lat: 0, lng: 0.05 }, start, end)).toBe(1);
  });

  it("is 0 for a segment with no length", () => {
    expect(progressAlong({ lat: 1, lng: 1 }, start, start)).toBe(0);
  });
});

describe("distanceToSegmentMeters", () => {
  it("is 0 for a point on the segment", () => {
    expect(distanceToSegmentMeters({ lat: 0, lng: 0.01 }, start, end)).toBeCloseTo(0, 3);
  });

  it("is the perpendicular distance beside the segment", () => {
    expect(distanceToSegmentMeters({ lat: 0.005, lng: 0.01 }, start, end)).toBeCloseTo(556, -1);
  });

  it("is the distance to the nearest end beyond it", () => {
    const beyond = { lat: 0, lng: 0.03 };

    expect(distanceToSegmentMeters(beyond, start, end)).toBeCloseTo(
      haversineMeters(beyond, end),
      3,
    );
  });

  it("is the distance to the point for a segment with no length", () => {
    const point = { lat: 0.01, lng: 0 };

    expect(distanceToSegmentMeters(point, start, start)).toBeCloseTo(
      haversineMeters(point, start),
      3,
    );
  });
});
