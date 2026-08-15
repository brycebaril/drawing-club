import { describe, expect, it } from "vitest";
import { combineDateAndTime, computeOccurrenceDates } from "./dates";

function isoDates(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString().slice(0, 10));
}

describe("computeOccurrenceDates", () => {
  it("finds every Monday in a month", () => {
    // 2026-01-01 is a Thursday.
    const dates = computeOccurrenceDates(1, new Date("2026-01-01T00:00:00"), new Date("2026-01-31T00:00:00"));
    expect(isoDates(dates)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
  });

  it("includes the range start when it's already the matching day", () => {
    // 2026-01-05 is itself a Monday.
    const dates = computeOccurrenceDates(1, new Date("2026-01-05T00:00:00"), new Date("2026-01-12T00:00:00"));
    expect(isoDates(dates)).toEqual(["2026-01-05", "2026-01-12"]);
  });

  it("includes the range end when it's exactly a matching day", () => {
    const dates = computeOccurrenceDates(1, new Date("2026-01-06T00:00:00"), new Date("2026-01-12T00:00:00"));
    expect(isoDates(dates)).toEqual(["2026-01-12"]);
  });

  it("returns nothing when the range is narrower than a week and misses the day", () => {
    // Range is Tue-Wed, looking for Fridays.
    const dates = computeOccurrenceDates(5, new Date("2026-01-06T00:00:00"), new Date("2026-01-07T00:00:00"));
    expect(dates).toEqual([]);
  });

  it("returns nothing when start is after end", () => {
    const dates = computeOccurrenceDates(1, new Date("2026-02-01T00:00:00"), new Date("2026-01-01T00:00:00"));
    expect(dates).toEqual([]);
  });
});

describe("combineDateAndTime", () => {
  it("sets the time-of-day on the given date", () => {
    const combined = combineDateAndTime(new Date("2026-01-05T00:00:00"), "18:30:00");
    expect(combined.getFullYear()).toBe(2026);
    expect(combined.getMonth()).toBe(0);
    expect(combined.getDate()).toBe(5);
    expect(combined.getHours()).toBe(18);
    expect(combined.getMinutes()).toBe(30);
  });
});
