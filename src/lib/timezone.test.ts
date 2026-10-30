import { describe, expect, it } from "vitest";
import {
  combineOrgDateAndTime,
  formatOrgDateTimeLocal,
  orgDateOnly,
  orgDateParts,
  parseOrgDateOnly,
  parseOrgDateTimeLocal,
  zonedWallTimeToInstant,
} from "./timezone";

// ORG_TIMEZONE defaults to America/Vancouver (no override in the test env) —
// these tests assert against that real IANA zone's actual DST transition
// dates, not a mock. If ORG_TIMEZONE is ever overridden in the test
// environment, these specific instants would need updating.

describe("zonedWallTimeToInstant / orgDateParts (round-trip)", () => {
  it("round-trips a winter (PST, UTC-8) wall-clock time", () => {
    const instant = zonedWallTimeToInstant(2026, 1, 15, 10, 30, 0);
    expect(instant.toISOString()).toBe("2026-01-15T18:30:00.000Z");
    expect(orgDateParts(instant)).toMatchObject({ year: 2026, month: 1, day: 15, hour: 10, minute: 30 });
  });

  it("round-trips a summer (PDT, UTC-7) wall-clock time", () => {
    const instant = zonedWallTimeToInstant(2026, 7, 15, 10, 30, 0);
    expect(instant.toISOString()).toBe("2026-07-15T17:30:00.000Z");
    expect(orgDateParts(instant)).toMatchObject({ year: 2026, month: 7, day: 15, hour: 10, minute: 30 });
  });

  it("reports the correct ORG_TIMEZONE weekday", () => {
    // 2026-01-05 is a Monday.
    const instant = zonedWallTimeToInstant(2026, 1, 5, 12, 0, 0);
    expect(orgDateParts(instant).weekday).toBe(1);
  });

  it("resolves an evening instant onto the correct (earlier) UTC-crossing calendar day", () => {
    // 7pm Wednesday Sept 2 Vancouver time is already Sept 3 in UTC — the
    // exact shape of bug this module exists to prevent (a naive UTC-ambient
    // read would show this as Thursday morning, not Wednesday evening).
    const instant = zonedWallTimeToInstant(2026, 9, 2, 19, 0, 0);
    expect(instant.toISOString()).toBe("2026-09-03T02:00:00.000Z");
    expect(orgDateParts(instant)).toMatchObject({ year: 2026, month: 9, day: 2, hour: 19, weekday: 3 });
  });
});

describe("orgDateOnly / parseOrgDateOnly (round-trip)", () => {
  it("round-trips a date string through midnight", () => {
    expect(orgDateOnly(parseOrgDateOnly("2026-03-15"))).toBe("2026-03-15");
  });

  it("parses to real ORG_TIMEZONE midnight, not UTC midnight", () => {
    // Winter (PST, UTC-8): local midnight is 08:00 UTC.
    expect(parseOrgDateOnly("2026-01-15").toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });
});

describe("combineOrgDateAndTime", () => {
  it("uses the date argument's own ORG_TIMEZONE calendar day, not its UTC day", () => {
    // parseOrgDateOnly("2026-09-02") is 2026-09-02T07:00:00Z (PDT) — its UTC
    // day and its ORG_TIMEZONE day agree here, but combineOrgDateAndTime
    // must derive "Sept 2" via the ORG_TIMEZONE reading, not assume it.
    const combined = combineOrgDateAndTime(parseOrgDateOnly("2026-09-02"), "19:00:00");
    expect(combined.toISOString()).toBe("2026-09-03T02:00:00.000Z");
  });
});

describe("parseOrgDateTimeLocal", () => {
  it("parses a datetime-local value as ORG_TIMEZONE wall-clock time, not the process's own zone", () => {
    // The exact bug this function replaces a raw `new Date(value)` parse to
    // fix: on Amplify's UTC-running Lambda, `new Date("2026-09-02T19:00")`
    // would parse "19:00" as UTC (an evening session landing as an 11am/
    // noon Pacific "morning" session) instead of 19:00 Vancouver time.
    const instant = parseOrgDateTimeLocal("2026-09-02T19:00");
    expect(instant.toISOString()).toBe("2026-09-03T02:00:00.000Z");
  });

  it("accepts an optional :SS component", () => {
    expect(parseOrgDateTimeLocal("2026-01-15T10:30:00").toISOString()).toBe("2026-01-15T18:30:00.000Z");
  });

  it("returns an Invalid Date for malformed input, matching native new Date(badInput)'s own shape", () => {
    expect(Number.isNaN(parseOrgDateTimeLocal("").getTime())).toBe(true);
    expect(Number.isNaN(parseOrgDateTimeLocal("not-a-date").getTime())).toBe(true);
  });
});

describe("formatOrgDateTimeLocal", () => {
  it("round-trips through parseOrgDateTimeLocal", () => {
    expect(formatOrgDateTimeLocal(parseOrgDateTimeLocal("2026-09-02T19:00"))).toBe("2026-09-02T19:00");
  });

  it("formats in ORG_TIMEZONE, not UTC or the process's own zone", () => {
    // zonedWallTimeToInstant(2026, 1, 15, 10, 30) is 2026-01-15T18:30:00.000Z
    // (PST, UTC-8) — formatting it back must read 10:30, not 18:30.
    expect(formatOrgDateTimeLocal(zonedWallTimeToInstant(2026, 1, 15, 10, 30))).toBe("2026-01-15T10:30");
  });
});
