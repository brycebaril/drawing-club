import { describe, expect, it } from "vitest";
import { currentWeekStart, parseDateOnly, sessionTypeNeedsModel } from "./shared";

describe("sessionTypeNeedsModel", () => {
  it("is false for the two drop-in types", () => {
    expect(sessionTypeNeedsModel("Gallery")).toBe(false);
    expect(sessionTypeNeedsModel("Party")).toBe(false);
  });

  it("is true for every drawing session type", () => {
    for (const type of ["L", "R", "G", "P", "S", "X"]) {
      expect(sessionTypeNeedsModel(type)).toBe(true);
    }
  });
});

describe("currentWeekStart", () => {
  // 2026-09-02 is a Wednesday; that week's Monday is 2026-08-31.
  it("returns the Monday of the same week for a midweek day", () => {
    expect(currentWeekStart(parseDateOnly("2026-09-02"))).toEqual(parseDateOnly("2026-08-31"));
  });

  it("returns itself for a Monday", () => {
    expect(currentWeekStart(parseDateOnly("2026-08-31"))).toEqual(parseDateOnly("2026-08-31"));
  });

  it("treats Sunday as the end of the *previous* Monday's week, not the start of the next", () => {
    expect(currentWeekStart(parseDateOnly("2026-09-06"))).toEqual(parseDateOnly("2026-08-31"));
  });

  it("truncates to ORG_TIMEZONE midnight regardless of the input's own time-of-day", () => {
    const lateInDay = new Date(parseDateOnly("2026-09-02").getTime() + 23 * 60 * 60 * 1000);
    expect(currentWeekStart(lateInDay)).toEqual(parseDateOnly("2026-08-31"));
  });
});
