import { ORG_TIMEZONE } from "@/lib/org";

/**
 * Org-timezone-aware date math. Every session in this app is a physical,
 * in-person event at one fixed real-world location — "18:00" always means
 * 6pm in ORG_TIMEZONE, regardless of what timezone the process computing or
 * displaying it happens to be running in. Native `Date` has no built-in way
 * to reason in an arbitrary IANA zone (only the process's own local zone via
 * getHours()/setHours()/etc., or UTC via the getUTC* variants) — these
 * helpers fill that gap using Intl.DateTimeFormat, without adding a
 * timezone library dependency.
 *
 * Found as a real bug, not a theoretical one: every date helper in this
 * codebase used to reason in the *process's own local timezone* (native
 * Date getters/setters). That was invisible as long as the app only ever
 * ran on a developer's own Pacific-timezone machine — it broke the moment
 * the app ran anywhere else (Amplify's Lambda runtime, which defaults to
 * UTC): migrated/created session times rendered and even *stored* up to 8
 * hours off, sometimes landing on the wrong calendar day entirely.
 */

const PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: ORG_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WEEKDAY_TO_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface OrgDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0=Sunday..6=Saturday, matching Date.getDay()
}

/** Decomposes an absolute instant into its ORG_TIMEZONE wall-clock components. */
export function orgDateParts(instant: Date): OrgDateParts {
  const parts = Object.fromEntries(PARTS_FORMAT.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_TO_INDEX[parts.weekday],
  };
}

/**
 * ORG_TIMEZONE's UTC offset (in minutes, `asIfUtcWallClock - realInstant`)
 * at the given instant — negative west of UTC (e.g. -420 for Vancouver's
 * PDT). An internal building block for zonedWallTimeToInstant; not usually
 * needed directly.
 */
function orgOffsetMinutesAt(instant: Date): number {
  const p = orgDateParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * Inverse of orgDateParts: given ORG_TIMEZONE wall-clock components,
 * returns the real absolute instant they refer to. Uses a single
 * DST-offset approximation pass (accurate except within the one skipped/
 * ambiguous hour of a spring-forward/fall-back transition itself — not
 * specially handled, same class of accepted edge case as this codebase's
 * existing excludeStartedDates reasoning).
 */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = orgOffsetMinutesAt(new Date(guessUtcMs));
  return new Date(guessUtcMs - offsetMinutes * 60_000);
}

/** ORG_TIMEZONE midnight of the instant's own ORG_TIMEZONE calendar day. */
export function orgStartOfDay(instant: Date): Date {
  const p = orgDateParts(instant);
  return zonedWallTimeToInstant(p.year, p.month, p.day);
}

/** ORG_TIMEZONE calendar-day difference between two instants' own ORG_TIMEZONE days (floor). */
export function orgDayIndex(gridStart: Date, instant: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((orgStartOfDay(instant).getTime() - orgStartOfDay(gridStart).getTime()) / msPerDay);
}

/**
 * Formats an instant as its ORG_TIMEZONE "YYYY-MM-DD" calendar day —
 * deliberately not `toISOString().slice(0, 10)` (UTC calendar day) or any
 * ambient-local-timezone getter (the process's own zone, not ORG_TIMEZONE).
 */
export function orgDateOnly(instant: Date): string {
  const p = orgDateParts(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Parses a "YYYY-MM-DD" string as ORG_TIMEZONE midnight — inverse of orgDateOnly. */
export function parseOrgDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return zonedWallTimeToInstant(year, month, day);
}

/** Combines an instant's ORG_TIMEZONE calendar day with a "HH:MM:SS" (or "HH:MM") time-of-day. */
export function combineOrgDateAndTime(date: Date, timeOfDay: string): Date {
  const [hours, minutes, seconds] = timeOfDay.split(":").map(Number);
  const p = orgDateParts(date);
  return zonedWallTimeToInstant(p.year, p.month, p.day, hours, minutes, seconds ?? 0);
}

/**
 * Parses a raw `<input type="datetime-local">` value ("YYYY-MM-DDTHH:MM" or
 * "...:SS") as ORG_TIMEZONE wall-clock time. This is the exact bug this
 * file's own header describes, found again for real: `new Date(value)` on
 * one of these zone-less strings parses it in the *process's* local
 * timezone, not ORG_TIMEZONE — invisible on a Pacific-timezone dev machine,
 * wrong by ~7-8 hours on Amplify's UTC-running Lambda (an evening session
 * landing as morning). Returns an Invalid Date (matching native `new
 * Date(badInput)`'s own behavior, not a thrown error) for malformed input,
 * so an existing `Number.isNaN(result.getTime())` validation check still
 * catches it the same way it caught a native parse failure before.
 */
export function parseOrgDateTimeLocal(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute, second] = match;
  return zonedWallTimeToInstant(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second ?? 0));
}
