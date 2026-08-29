import { describe, expect, it } from "vitest";
import { computeSessionStatus, viewerBookingWindowDays } from "./sessionStatus";
import type { Role } from "@/lib/auth/roles";

const NOW = new Date("2026-01-01T12:00:00Z");
const ACCT: Role[] = ["ACCT"];
const MBR: Role[] = ["ACCT", "MBR"];
const ADMIN: Role[] = ["ACCT", "ADMIN"];

function baseInput(overrides: Partial<Parameters<typeof computeSessionStatus>[0]> = {}) {
  return {
    session: { startTime: new Date("2026-01-05T18:00:00Z"), maxCapacity: 2 },
    roles: ACCT,
    bookedCount: 0,
    viewerHasBooking: false,
    viewerOnWaitlist: false,
    cancellationCutoffHours: 24,
    bookingWindowAccountDays: 14,
    bookingWindowMemberDays: 30,
    now: NOW,
    ...overrides,
  };
}

describe("computeSessionStatus", () => {
  it("NoSession when there's no session", () => {
    expect(computeSessionStatus(baseInput({ session: null }))).toBe("NoSession");
  });

  it("Available when within window, under capacity, not booked", () => {
    expect(computeSessionStatus(baseInput())).toBe("Available");
  });

  it("Registered when the viewer has a booking, well before the cutoff", () => {
    expect(computeSessionStatus(baseInput({ viewerHasBooking: true }))).toBe("Registered");
  });

  it("CancelableNoRefund when the viewer has a booking inside the cutoff window", () => {
    const session = { startTime: new Date("2026-01-01T18:00:00Z"), maxCapacity: 2 }; // 6h from NOW
    expect(computeSessionStatus(baseInput({ session, viewerHasBooking: true }))).toBe(
      "CancelableNoRefund",
    );
  });

  it("Full when at capacity and the viewer hasn't booked or waitlisted", () => {
    expect(computeSessionStatus(baseInput({ bookedCount: 2 }))).toBe("Full");
  });

  it("OnWaitlist when at capacity and the viewer is already waitlisted", () => {
    expect(computeSessionStatus(baseInput({ bookedCount: 2, viewerOnWaitlist: true }))).toBe(
      "OnWaitlist",
    );
  });

  it("TooFarFuture for an Account Holder beyond their 14-day window", () => {
    const session = { startTime: new Date("2026-01-20T18:00:00Z"), maxCapacity: 2 }; // 19 days out
    expect(computeSessionStatus(baseInput({ session, roles: ACCT }))).toBe("TooFarFuture");
  });

  it("Available for a Paid Member within their 30-day window at the same date", () => {
    const session = { startTime: new Date("2026-01-20T18:00:00Z"), maxCapacity: 2 };
    expect(computeSessionStatus(baseInput({ session, roles: MBR }))).toBe("Available");
  });

  it("registration overrides TooFarFuture — an existing booking is never hidden by window math", () => {
    const session = { startTime: new Date("2026-01-20T18:00:00Z"), maxCapacity: 2 };
    expect(
      computeSessionStatus(baseInput({ session, roles: ACCT, viewerHasBooking: true })),
    ).toBe("Registered");
  });

  it("Available for a guest regardless of date — the booking window doesn't apply to null roles", () => {
    // Far beyond even a Member's 30-day window (19 days would already be
    // TooFarFuture for an Account Holder per the test above).
    const session = { startTime: new Date("2026-03-01T18:00:00Z"), maxCapacity: 2 };
    expect(computeSessionStatus(baseInput({ session, roles: null }))).toBe("Available");
  });

  it("Full for a guest when a far-future session is already at capacity", () => {
    const session = { startTime: new Date("2026-03-01T18:00:00Z"), maxCapacity: 2 };
    expect(computeSessionStatus(baseInput({ session, roles: null, bookedCount: 2 }))).toBe("Full");
  });
});

describe("viewerBookingWindowDays", () => {
  it("guests get 0", () => {
    expect(viewerBookingWindowDays(null, 14, 30)).toBe(0);
  });

  it("Account Holders get the account window", () => {
    expect(viewerBookingWindowDays(ACCT, 14, 30)).toBe(14);
  });

  it("Paid Members get the (longer) member window", () => {
    expect(viewerBookingWindowDays(MBR, 14, 30)).toBe(30);
  });

  it("Admins are unrestricted", () => {
    expect(viewerBookingWindowDays(ADMIN, 14, 30)).toBe(Infinity);
  });
});
