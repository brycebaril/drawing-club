import { describe, expect, it } from "vitest";
import { summarizeUserRows } from "./users";
import { summarizeAttendance } from "./attendance";
import { groupRevenueByWeek } from "./revenue";
import { summarizeAccountClasses } from "./accountClasses";
import { summarizeAccountActivity } from "./accountActivity";
import { summarizeTicketCirculation } from "./ticketCirculation";

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

describe("summarizeAccountClasses", () => {
  it("computes each class's active-this-week percentage independently", () => {
    const result = summarizeAccountClasses({
      admin_total: 4,
      admin_active: 2,
      volunteer_total: 10,
      volunteer_active: 5,
      member_total: 100,
      member_active: 20,
      account_holder_total: 50,
      account_holder_active: 1,
    });
    expect(result.admin).toEqual({ total: 4, activeThisWeek: 2, activePct: 0.5 });
    expect(result.volunteer).toEqual({ total: 10, activeThisWeek: 5, activePct: 0.5 });
    expect(result.member.activePct).toBe(0.2);
    expect(result.accountHolder.activePct).toBe(0.02);
  });

  it("reports null (not 0) activePct for a class with no members", () => {
    const result = summarizeAccountClasses({
      admin_total: 0,
      admin_active: 0,
      volunteer_total: 0,
      volunteer_active: 0,
      member_total: 0,
      member_active: 0,
      account_holder_total: 0,
      account_holder_active: 0,
    });
    expect(result.admin.activePct).toBeNull();
    expect(result.member.activePct).toBeNull();
  });
});

describe("summarizeAccountActivity", () => {
  it("passes through the trailing-7-day counts unchanged", () => {
    const result = summarizeAccountActivity({ new_accounts: 3, new_signups: 2, renewals: 5, expirations: 1 });
    expect(result).toEqual({ newAccounts: 3, newMembershipSignups: 2, renewals: 5, membershipExpirations: 1 });
  });
});

describe("summarizeTicketCirculation", () => {
  it("computes average cost basis from total liability over outstanding count", () => {
    const result = summarizeTicketCirculation(
      { count: 100, total_value: "1500.00" },
      { count: 20, total_value: "300.00" },
    );
    expect(result).toEqual({
      outstandingCount: 100,
      transferableCount: 20,
      avgCostBasis: 15,
      totalLiability: 1500,
    });
  });

  it("reports null avgCostBasis (not 0 or NaN) when there are no outstanding tickets", () => {
    const result = summarizeTicketCirculation({ count: 0, total_value: "0" }, { count: 0, total_value: "0" });
    expect(result.avgCostBasis).toBeNull();
    expect(result.totalLiability).toBe(0);
  });

  it("treats a missing row as zero rather than throwing", () => {
    const result = summarizeTicketCirculation(undefined, undefined);
    expect(result).toEqual({ outstandingCount: 0, transferableCount: 0, avgCostBasis: null, totalLiability: 0 });
  });
});
