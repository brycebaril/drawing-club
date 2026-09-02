import { describe, expect, it } from "vitest";
import { clampRangeStart, combineDateAndTime, computeOccurrenceDates, excludeStartedDates } from "./dates";
import { orgDateParts, parseOrgDateOnly, zonedWallTimeToInstant } from "@/lib/timezone";

// Every Date constructed here uses parseOrgDateOnly/zonedWallTimeToInstant
// (explicit ORG_TIMEZONE anchoring) rather than bare `new Date("YYYY-MM-
// DDTHH:MM:SS")` strings, and every assertion reads back via orgDateParts
// rather than native getHours()/getDate()/etc. — deliberately, so these
// tests pass identically regardless of the machine/CI runner's own ambient
// timezone. The previous version used ambiguous local-parsed strings and
// only happened to pass in both a Pacific dev machine and a UTC CI runner
// because assertions never checked below calendar-day granularity — exactly
// the class of environment-dependent bug this whole module was rewritten to
// fix; leaving the tests ambiguous would have reintroduced it one layer up.

function isoDates(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString().slice(0, 10));
}

describe("computeOccurrenceDates", () => {
  it("finds every Monday in a month", () => {
    // 2026-01-01 is a Thursday.
    const dates = computeOccurrenceDates(1, parseOrgDateOnly("2026-01-01"), parseOrgDateOnly("2026-01-31"));
    expect(isoDates(dates)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
  });

  it("includes the range start when it's already the matching day", () => {
    // 2026-01-05 is itself a Monday.
    const dates = computeOccurrenceDates(1, parseOrgDateOnly("2026-01-05"), parseOrgDateOnly("2026-01-12"));
    expect(isoDates(dates)).toEqual(["2026-01-05", "2026-01-12"]);
  });

  it("includes the range end when it's exactly a matching day", () => {
    const dates = computeOccurrenceDates(1, parseOrgDateOnly("2026-01-06"), parseOrgDateOnly("2026-01-12"));
    expect(isoDates(dates)).toEqual(["2026-01-12"]);
  });

  it("returns nothing when the range is narrower than a week and misses the day", () => {
    // Range is Tue-Wed, looking for Fridays.
    const dates = computeOccurrenceDates(5, parseOrgDateOnly("2026-01-06"), parseOrgDateOnly("2026-01-07"));
    expect(dates).toEqual([]);
  });

  it("returns nothing when start is after end", () => {
    const dates = computeOccurrenceDates(1, parseOrgDateOnly("2026-02-01"), parseOrgDateOnly("2026-01-01"));
    expect(dates).toEqual([]);
  });

  it("spans a spring-forward DST transition without skipping or duplicating a week", () => {
    // Vancouver springs forward 2026-03-08. A Monday rule shouldn't care.
    const dates = computeOccurrenceDates(1, parseOrgDateOnly("2026-03-01"), parseOrgDateOnly("2026-03-31"));
    expect(isoDates(dates)).toEqual(["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]);
  });
});

describe("combineDateAndTime", () => {
  it("sets the ORG_TIMEZONE time-of-day on the given date, regardless of the runner's own timezone", () => {
    const combined = combineDateAndTime(parseOrgDateOnly("2026-01-05"), "18:30:00");
    const parts = orgDateParts(combined);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(1);
    expect(parts.day).toBe(5);
    expect(parts.hour).toBe(18);
    expect(parts.minute).toBe(30);
  });

  it("resolves the correct instant across a DST boundary (summer offset differs from winter)", () => {
    const combined = combineDateAndTime(parseOrgDateOnly("2026-07-05"), "18:30:00");
    const parts = orgDateParts(combined);
    expect(parts.hour).toBe(18);
    expect(parts.minute).toBe(30);
    // Vancouver is UTC-7 in July (PDT) vs UTC-8 in January (PST) — a real
    // instant difference, not just a display difference.
    expect(combined.toISOString()).toBe("2026-07-06T01:30:00.000Z");
  });
});

describe("clampRangeStart", () => {
  it("passes the candidate through unchanged when it's already on or after the rule's start date", () => {
    const clamped = clampRangeStart(parseOrgDateOnly("2026-02-01"), parseOrgDateOnly("2026-01-01"));
    expect(clamped.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("clamps forward to the rule's start date when the candidate is earlier", () => {
    const clamped = clampRangeStart(parseOrgDateOnly("2025-12-01"), parseOrgDateOnly("2026-01-01"));
    expect(clamped.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("passes the candidate through when it exactly equals the rule's start date", () => {
    const clamped = clampRangeStart(parseOrgDateOnly("2026-01-01"), parseOrgDateOnly("2026-01-01"));
    expect(clamped.toISOString().slice(0, 10)).toBe("2026-01-01");
  });
});

describe("excludeStartedDates", () => {
  const dates = [parseOrgDateOnly("2026-01-05"), parseOrgDateOnly("2026-01-12"), parseOrgDateOnly("2026-01-19")];

  it("drops today's date when its time-of-day slot has already passed 'after'", () => {
    // Editing a rule at 2pm Vancouver time on Jan 5, after that day's 10am slot already ran.
    const after = zonedWallTimeToInstant(2026, 1, 5, 14, 0, 0);
    const result = excludeStartedDates(dates, "10:00:00", after);
    expect(result.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-12", "2026-01-19"]);
  });

  it("keeps today's date when its time-of-day slot is still upcoming", () => {
    // Editing a rule at 9am Vancouver time on Jan 5, before that day's 10am slot runs.
    const after = zonedWallTimeToInstant(2026, 1, 5, 9, 0, 0);
    const result = excludeStartedDates(dates, "10:00:00", after);
    expect(result.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("is a no-op when 'after' is midnight (a this-and-future edit's picked date) — every same-day slot is later", () => {
    const after = zonedWallTimeToInstant(2026, 1, 5, 0, 0, 0);
    const result = excludeStartedDates(dates, "10:00:00", after);
    expect(result.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });
});
