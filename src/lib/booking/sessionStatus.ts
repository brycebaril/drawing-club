import type { Role } from "@/lib/auth/roles";
import { isCancellable } from "@/lib/cancellation";

// Design Doc §3.3's visual states, minus "No Model Assigned" (model
// assignment isn't in scope yet — Phase 3 plan's scope boundary).
export type SessionStatus =
  | "NoSession"
  | "Available"
  | "Registered"
  | "NonCancelable"
  | "Full"
  | "OnWaitlist"
  | "TooFarFuture";

export interface SessionStatusInput {
  session: { startTime: Date; maxCapacity: number } | null;
  /** null = guest (nothing bookable). From getUserAuthContext().roles. */
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
  const { startTime, maxCapacity } = input.session;

  if (input.viewerHasBooking) {
    return isCancellable(startTime, input.cancellationCutoffHours, now)
      ? "Registered"
      : "NonCancelable";
  }

  const windowDays = viewerBookingWindowDays(
    input.roles,
    input.bookingWindowAccountDays,
    input.bookingWindowMemberDays,
  );
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  if (startTime > windowEnd) return "TooFarFuture";

  if (input.bookedCount >= maxCapacity) {
    return input.viewerOnWaitlist ? "OnWaitlist" : "Full";
  }

  return "Available";
}
