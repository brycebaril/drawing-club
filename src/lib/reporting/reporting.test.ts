import { describe, expect, it } from "vitest";
import { summarizeUserRows } from "./users";
import { summarizeAttendance } from "./attendance";
import { groupRevenueByWeek } from "./revenue";

describe("summarizeUserRows", () => {
  it("rolls up counts across base_role and status independently", () => {
    const result = summarizeUserRows([
      { base_role: "AccountHolder", status: "Active", count: 10 },
      { base_role: "AccountHolder", status: "Suspended", count: 2 },
      { base_role: "Admin", status: "Active", count: 1 },
    ]);
    expect(result).toEqual({
      totalUsers: 13,
      byBaseRole: { AccountHolder: 12, Admin: 1 },
      byStatus: { Active: 11, Suspended: 2 },
    });
  });

  it("returns zeroed totals for no rows", () => {
    expect(summarizeUserRows([])).toEqual({ totalUsers: 0, byBaseRole: {}, byStatus: {} });
  });
});

describe("summarizeAttendance", () => {
  it("computes attendance rate as checked-in over total bookings", () => {
    const result = summarizeAttendance([
      { week_start: new Date("2026-08-03"), sessions_run: 4, total_bookings: 40, checked_in_bookings: 30 },
    ]);
    expect(result[0].attendanceRate).toBe(0.75);
  });

  it("reports null (not 0) for a week with no bookings", () => {
    const result = summarizeAttendance([
      { week_start: new Date("2026-08-03"), sessions_run: 0, total_bookings: 0, checked_in_bookings: 0 },
    ]);
    expect(result[0].attendanceRate).toBeNull();
  });
});

describe("groupRevenueByWeek", () => {
  it("groups multiple item_type rows for the same week into one entry", () => {
    const result = groupRevenueByWeek([
      { week_start: new Date("2026-08-03"), item_type: "SinglePass", count: 5, total: "100.00" },
      { week_start: new Date("2026-08-03"), item_type: "MembershipRenewal", count: 2, total: "120.00" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].totalRevenue).toBe(220);
    expect(result[0].byItemType).toEqual({
      SinglePass: { count: 5, total: 100 },
      MembershipRenewal: { count: 2, total: 120 },
    });
  });

  it("sorts weeks ascending regardless of input order", () => {
    const result = groupRevenueByWeek([
      { week_start: new Date("2026-08-10"), item_type: "SinglePass", count: 1, total: "20.00" },
      { week_start: new Date("2026-08-03"), item_type: "SinglePass", count: 1, total: "20.00" },
    ]);
    expect(result.map((r) => r.weekStart.toISOString())).toEqual([
      new Date("2026-08-03").toISOString(),
      new Date("2026-08-10").toISOString(),
    ]);
  });
});
