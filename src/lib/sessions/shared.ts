import { orgDateParts, orgStartOfDay, orgDayIndex, orgDateOnly, parseOrgDateOnly } from "@/lib/timezone";

// Design Doc §3.2.
export const SESSION_TYPES = ["L", "R", "G", "P", "S", "X", "Gallery", "Party"] as const;

// Gallery Hours and Party are the two "drop-in" types (SESSION_TYPE_INFO's
// own sage-vs-terracotta split in the schedule grid) — no live model posing
// happens at either, unlike every other type. Every session-creation path
// (one-off, recurring, series) should call this rather than leaving
// model_required to its DB default (always true) regardless of type, which
// used to mean a newly created Party/Gallery Hours session always showed as
// "needs a model" until a Model Booker manually cleared it by hand.
export function sessionTypeNeedsModel(sessionType: string): boolean {
  return sessionType !== "Gallery" && sessionType !== "Party";
}

// Gallery Hours and Party are announcements — a reserved calendar block
// with details, not a bookable session: no ticket, no RSVP, no capacity
// tracking. Only the general-admission creation paths (one-off, recurring)
// should call this; multi-week series sessions are deliberately excluded
// (a numbered-seat series is inherently a ticketed concept by
// construction) — those creation paths keep is_ticketed hardcoded true.
export function sessionTypeIsTicketed(sessionType: string): boolean {
  return sessionType !== "Gallery" && sessionType !== "Party";
}

// Matches JS Date.getDay() (0=Sunday..6=Saturday).
export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export const SLOTS = ["Morning", "Afternoon", "Evening"] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * Canonical start/end time-of-day for each slot — matches slotFor's hour
 * boundaries (14, 18) below. Used wherever a new session needs a concrete
 * time derived from just a slot choice (the multi-week series slot picker).
 */
export const SLOT_TIMES: Record<Slot, { start: string; end: string }> = {
  Morning: { start: "10:00", end: "13:00" },
  Afternoon: { start: "14:00", end: "17:00" },
  Evening: { start: "18:00", end: "21:00" },
};

// All four of these delegate to src/lib/timezone.ts's ORG_TIMEZONE-aware
// helpers rather than reasoning in the *process's own* local timezone
// (native Date getters/setters) — a real bug found once this app ran
// anywhere but a developer's own Pacific-timezone machine (see
// src/lib/timezone.ts's own doc comment). Signatures are unchanged so every
// existing caller (the schedule grid, the admin calendar grid, the series
// slot picker) picks up the fix automatically.

export function slotFor(date: Date): Slot {
  const hour = orgDateParts(date).hour;
  if (hour < 14) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

export function startOfDay(date: Date): Date {
  return orgStartOfDay(date);
}

/**
 * ORG_TIMEZONE midnight of the most recent Monday on or before `now` — the
 * Monday-through-Sunday week convention this app's weekly reports/grants
 * already use (model payout reports, volunteer pass grants). Was
 * previously duplicated in src/app/admin/passes/actions.ts and
 * scripts/grant-volunteer-passes.ts using native Date getters/setters,
 * which reason in the *process's own* local timezone rather than
 * ORG_TIMEZONE — the exact bug class src/lib/timezone.ts's own doc comment
 * says already broke this app once on a UTC-default runtime. Fixed by
 * building on orgStartOfDay/orgDateParts instead, same as every other date
 * helper here.
 */
export function currentWeekStart(now: Date): Date {
  const startOfToday = orgStartOfDay(now);
  const day = orgDateParts(now).weekday; // 0=Sunday..6=Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return new Date(startOfToday.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

export function dayIndex(gridStart: Date, date: Date): number {
  return orgDayIndex(gridStart, date);
}

/**
 * Formats a Date as its ORG_TIMEZONE "YYYY-MM-DD" calendar day —
 * deliberately not `toISOString().slice(0, 10)` (UTC calendar day) or any
 * ambient-process-local-timezone getter (see src/lib/timezone.ts).
 */
export function toDateOnly(date: Date): string {
  return orgDateOnly(date);
}

/** Parses a "YYYY-MM-DD" string as ORG_TIMEZONE midnight — the inverse of toDateOnly. */
export function parseDateOnly(dateStr: string): Date {
  return parseOrgDateOnly(dateStr);
}
