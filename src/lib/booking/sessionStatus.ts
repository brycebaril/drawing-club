import type { Role } from "@/lib/auth/roles";
import { isCancellable } from "@/lib/cancellation";

// Design Doc §3.3's visual states, plus "No Model Assigned" (now surfaced
// separately by the schedule page — see scheduleTypes.ts's needsModel, not
// folded into this union since it's an independent overlay, not a
// mutually-exclusive state).
export type SessionStatus =
  | "NoSession"
  | "Available"
  | "Registered"
  | "CancelableNoRefund"
  | "Full"
  | "OnWaitlist"
  | "TooFarFuture";

export interface SessionStatusInput {
  session: { startTime: Date; maxCapacity: number; isTicketed: boolean } | null;
  /**
   * null = guest. From getUserAuthContext().roles. A guest still resolves
   * to a real Available/Full status (the unified public + member schedule
   * page shows a real preview, not a wall of locked cells) — they just
   * never reach Registered/CancelableNoRefund/OnWaitlist, since
   * viewerHasBooking/viewerOnWaitlist are always false for them, and the
   * booking-window check (TooFarFuture) is skipped entirely for null roles.
   */
  roles: Role[] | null;
  bookedCount: number;
  viewerHasBooking: boolean;
  viewerOnWaitlist: boolean;
  cancellationCutoffHours: number;
  bookingWindowAccountDays: number;
  bookingWindowMemberDays: number;
  now?: Date;
}

/**
 * Days into the future this viewer can see/book sessions (Design Doc §12.1).
 * Admins get unrestricted visibility, consistent with their blanket access
 * elsewhere (Design Doc §5.2) — not explicitly spelled out for booking
 * windows specifically, but the only sensible reading given the rest of
 * their access.
 */
export function viewerBookingWindowDays(
  roles: Role[] | null,
  accountDays: number,
  memberDays: number,
): number {
  if (!roles) return 0;
  if (roles.includes("ADMIN")) return Infinity;
  return roles.includes("MBR") ? memberDays : accountDays;
}

export function computeSessionStatus(input: SessionStatusInput): SessionStatus {
  const now = input.now ?? new Date();
  if (!input.session) return "NoSession";
  const { startTime, maxCapacity, isTicketed } = input.session;

  if (input.viewerHasBooking) {
    return isCancellable(startTime, input.cancellationCutoffHours, now)
      ? "Registered"
      : "CancelableNoRefund";
  }

  // A Party/Gallery Hours announcement (see sessionTypeIsTicketed,
  // src/lib/sessions/shared.ts) is never gated by the booking window —
  // there's nothing to book ahead of — and never becomes Full/OnWaitlist,
  // since nothing tracks capacity for it. It always reads as Available.
  if (isTicketed) {
    // The booking window gates *which authenticated tier* can book how far
    // out (an Account Holder vs. Member upsell) — it has no meaning for a
    // fully anonymous guest, who can't book at all regardless of date. Guests
    // skip straight to the capacity check instead of landing on TooFarFuture
    // for every session (viewerBookingWindowDays returns 0 for null roles,
    // which is correct for "can this viewer book" but wrong for "what should
    // a public schedule preview display").
    if (input.roles !== null) {
      const windowDays = viewerBookingWindowDays(
        input.roles,
        input.bookingWindowAccountDays,
        input.bookingWindowMemberDays,
      );
      const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
      if (startTime > windowEnd) return "TooFarFuture";
    }

    if (input.bookedCount >= maxCapacity) {
      return input.viewerOnWaitlist ? "OnWaitlist" : "Full";
    }
  }

  return "Available";
}
