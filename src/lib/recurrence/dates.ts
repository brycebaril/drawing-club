import { orgStartOfDay, orgDateParts, zonedWallTimeToInstant, combineOrgDateAndTime } from "@/lib/timezone";

/**
 * Every date matching `dayOfWeek` (0=Sunday..6=Saturday, matching
 * ORG_TIMEZONE's own local weekday — see src/lib/timezone.ts) within
 * [rangeStart, rangeEnd] inclusive. Pure — no DB, no "now" — so callers
 * control exactly what range gets generated.
 *
 * Reasons in ORG_TIMEZONE, not the process's own local timezone: a real bug
 * found once this ran anywhere but a developer's own Pacific-timezone
 * machine — on a server whose ambient timezone is UTC (Amplify's Lambda
 * runtime default), the old `.getDay()`/`.setDate()`-based version would
 * compute the wrong day-of-week boundary for any date near midnight
 * Pacific, and worse, combineDateAndTime (below) would store a rule's
 * "18:00" time-of-day as 18:00 UTC instead of 18:00 Vancouver time.
 */
export function computeOccurrenceDates(
  dayOfWeek: number,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const dates: Date[] = [];

  let cursor = orgStartOfDay(rangeStart);
  const end = orgStartOfDay(rangeEnd);

  // Advance to the first matching day of week, then step by exactly a week.
  const daysUntilFirstMatch = (dayOfWeek - orgDateParts(cursor).weekday + 7) % 7;
  cursor = addOrgDays(cursor, daysUntilFirstMatch);

  while (cursor <= end) {
    dates.push(cursor);
    cursor = addOrgDays(cursor, 7);
  }

  return dates;
}

/** Adds `days` ORG_TIMEZONE calendar days to an ORG_TIMEZONE-midnight instant. */
function addOrgDays(orgMidnight: Date, days: number): Date {
  const p = orgDateParts(orgMidnight);
  // Date.UTC normalizes an out-of-range day (e.g. day 32) into the next
  // month correctly — reused here as plain calendar-day arithmetic, then
  // re-anchored to a real ORG_TIMEZONE midnight via zonedWallTimeToInstant.
  const normalized = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedWallTimeToInstant(
    normalized.getUTCFullYear(),
    normalized.getUTCMonth() + 1,
    normalized.getUTCDate(),
  );
}

/** Combines a calendar date's ORG_TIMEZONE day with a "HH:MM:SS" time-of-day into one instant. */
export function combineDateAndTime(date: Date, timeOfDay: string): Date {
  return combineOrgDateAndTime(date, timeOfDay);
}

/** Never generate/regenerate before a rule's own start_date, regardless of the candidate range start. */
export function clampRangeStart(candidate: Date, ruleStartDate: Date): Date {
  return candidate < ruleStartDate ? new Date(ruleStartDate) : new Date(candidate);
}

/**
 * Drops any candidate date whose combined `timeOfDay` instant already falls
 * at or before `after` — `computeOccurrenceDates` only reasons about whole
 * calendar days, so on its own it can't tell "today, but the slot already
 * happened" from "today, still upcoming." Regenerating with an exact `now()`
 * anchor (an "entire rule" edit) needs this to avoid re-inserting a
 * duplicate for a day whose occurrence already ran; regenerating with a
 * midnight-anchored date (a "this-and-future" edit's picked date) is
 * unaffected, since every same-day instant is after that day's midnight.
 */
export function excludeStartedDates(dates: Date[], timeOfDay: string, after: Date): Date[] {
  return dates.filter((date) => combineDateAndTime(date, timeOfDay) > after);
}
