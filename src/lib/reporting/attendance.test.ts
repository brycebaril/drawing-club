import { describe, expect, it } from "vitest";
import { summarizeAttendance, summarizeNoShows, type WeeklyAttendanceRow } from "./attendance";

describe("summarizeAttendance", () => {
  it("derives noShows as bookings minus checked-in", () => {
    const rows: WeeklyAttendanceRow[] = [
      { week_start: new Date("2026-08-03"), sessions_run: 3, total_bookings: 10, checked_in_bookings: 7 },
    ];
    const [week] = summarizeAttendance(rows);
    expect(week.noShows).toBe(3);
    expect(week.attendanceRate).toBeCloseTo(0.7);
  });

  it("has zero noShows when every booking checked in", () => {
    const rows: WeeklyAttendanceRow[] = [
      { week_start: new Date("2026-08-03"), sessions_run: 1, total_bookings: 5, checked_in_bookings: 5 },
    ];
    expect(summarizeAttendance(rows)[0].noShows).toBe(0);
  });
});

describe("summarizeNoShows", () => {
  it("sums noShows and totalBookings across weeks into a single rate", () => {
    const trend = summarizeAttendance([
      { week_start: new Date("2026-08-03"), sessions_run: 2, total_bookings: 10, checked_in_bookings: 8 },
      { week_start: new Date("2026-08-10"), sessions_run: 2, total_bookings: 10, checked_in_bookings: 5 },
    ]);
    const { totalNoShows, noShowRate } = summarizeNoShows(trend);
    expect(totalNoShows).toBe(7);
    expect(noShowRate).toBeCloseTo(0.35);
  });

  it("is null, not 0, when the whole window had no bookings", () => {
    expect(summarizeNoShows([]).noShowRate).toBeNull();
    expect(summarizeNoShows([]).totalNoShows).toBe(0);
  });
});
