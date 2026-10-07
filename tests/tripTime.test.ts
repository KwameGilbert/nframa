import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { departureAt, isoWeekday, today } from "../src/utils/tripTime.js";

describe("tripTime", () => {
  it.each([
    ["2026-09-28", 1], // Monday
    ["2026-10-01", 4],
    ["2026-10-03", 6],
    ["2026-10-04", 7], // Sunday
    ["2028-02-29", 2],
  ])("%s is ISO weekday %i", (date, weekday) => {
    expect(isoWeekday(date)).toBe(weekday);
  });

  it.each(["2026-02-30", "not-a-date", ""])("refuses the invalid date %j", (date) => {
    expect(() => isoWeekday(date)).toThrow("Invalid date");
  });

  it("reads a commute's departure time as Ghana (UTC) time on the date", () => {
    expect(departureAt("2026-10-01", "07:15:00").toISOString()).toBe("2026-10-01T07:15:00.000Z");
    expect(departureAt("2026-10-01", "18:30").toISOString()).toBe("2026-10-01T18:30:00.000Z");
  });

  it("gives today's date in Ghana time", () => {
    expect(today(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09-30");
    expect(today(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
  });

  // Runs the helpers in a process whose clock is far from UTC on either side.
  it.each(["Pacific/Kiritimati", "America/Los_Angeles"])(
    "gives the same answers when the server's TZ is %s",
    (tz) => {
      const helpers = fileURLToPath(new URL("../src/utils/tripTime.ts", import.meta.url));
      // On Windows, convert path to file:// URL for proper import handling
      const importPath =
        process.platform === "win32" ? `file:///${helpers.replace(/\\/g, "/")}` : helpers;
      const script = `const t = await import(${JSON.stringify(importPath)});
        console.log(JSON.stringify([
          t.today(new Date("2026-09-30T23:30:00Z")),
          t.isoWeekday("2026-10-04"),
          t.departureAt("2026-10-01", "07:15:00").toISOString(),
        ]));`;
      const out = execFileSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          env: { ...process.env, TZ: tz },
          encoding: "utf8",
        },
      );
      expect(JSON.parse(out)).toEqual(["2026-09-30", 7, "2026-10-01T07:15:00.000Z"]);
    },
  );
});
