import type { SessionStatus } from "@/lib/booking/sessionStatus";
import { ORG_TIMEZONE } from "@/lib/org";
import { orgDateParts } from "@/lib/timezone";
import { memberLabel } from "@/lib/users/memberLabel";

export interface SessionTypeInfo {
  label: string;
  display: string;
  textClass: string;
}

// The type letter distinguishes L/R/G/P/S/X — color no longer does. Only two
// voices (Design Philosophy.dc.html §02/§09): terracotta for every ticketed
// type, sage for Gallery Hours/Party (no ticket involved, "drop in"
// language). Eight per-type hues read as a single biggest departure from
// the old design, where each type's own hue then had to compete with seven
// status colors in the same small cell — see the Rebuild-the-grid-cell step
// in the implementation plan for the fuller reasoning.
export const SESSION_TYPE_INFO: Record<string, SessionTypeInfo> = {
  L: { label: "Long Pose", display: "L", textClass: "text-type-ticketed" },
  R: { label: "Regular", display: "R", textClass: "text-type-ticketed" },
  G: { label: "Gesture", display: "G", textClass: "text-type-ticketed" },
  P: { label: "Portrait", display: "P", textClass: "text-type-ticketed" },
  S: { label: "Special", display: "S", textClass: "text-type-ticketed" },
  X: { label: "Extra Long Pose", display: "X", textClass: "text-type-ticketed" },
  Gallery: { label: "Gallery Hours", display: "Ga", textClass: "text-type-open" },
  Party: { label: "Party", display: "Pa", textClass: "text-type-open" },
};

export function sessionTypeInfo(type: string): SessionTypeInfo {
  return SESSION_TYPE_INFO[type] ?? { label: type, display: type.slice(0, 2), textClass: "text-ink" };
}

export interface GridCellData {
  id: string;
  sessionType: string;
  status: SessionStatus;
  needsModel: boolean;
  description: string | null;
  startTime: Date;
  endTime: Date;
  hostUsername: string | null;
  hostDisplayName: string | null;
  modelRequired: boolean;
  modelNames: string | null;
  bookedCount: number;
  maxCapacity: number;
}

const TOOLTIP_TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ORG_TIMEZONE });
const OPENS_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: ORG_TIMEZONE });

/** "6:00 PM" -> "6:00" — the cell's own bottom line has no room for AM/PM,
 * and the Morning/Afternoon/Evening slot row it sits in already disambiguates. */
export function formatCellTime(date: Date): string {
  return TOOLTIP_TIME_FORMAT.format(date).replace(/\s?[AP]M$/i, "");
}

/** "12 Sep" — used for a Locked cell's "Opens 12 Sep" line, and the header's
 * "booking open through" date. */
export function formatOpensDate(date: Date): string {
  return OPENS_DATE_FORMAT.format(date);
}

const WEEK_RANGE_DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: ORG_TIMEZONE });
const WEEK_RANGE_MONTH_DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: ORG_TIMEZONE });

/** "1 – 7 September" / "28 August – 3 September" — the page header for a
 * displayed 7-day week. `end` is exclusive (viewStart + 7 days). */
export function formatWeekRange(start: Date, end: Date): string {
  const last = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const startParts = orgDateParts(start);
  const lastParts = orgDateParts(last);
  const sameMonth = startParts.month === lastParts.month && startParts.year === lastParts.year;
  return sameMonth
    ? `${WEEK_RANGE_DAY_FORMAT.format(start)} – ${WEEK_RANGE_MONTH_DAY_FORMAT.format(last)}`
    : `${WEEK_RANGE_MONTH_DAY_FORMAT.format(start)} – ${WEEK_RANGE_MONTH_DAY_FORMAT.format(last)}`;
}

export function describeModel(cell: GridCellData): string {
  if (cell.modelNames) return cell.modelNames;
  return cell.modelRequired ? "Not yet assigned" : "None required";
}

/**
 * Mouseover elaboration for a grid cell — the cell itself only has room for
 * a one/two-letter session-type glyph (see sessionTypeInfo), so anything
 * beyond that (the session's own name, who's modeling, capacity) has nowhere
 * else to show without opening the cell. A plain `title` attribute rather
 * than a custom tooltip component, matching every other hover hint already
 * on this page (EmptyCell, the corner status icons).
 */
export function describeCellTooltip(cell: GridCellData): string {
  const info = sessionTypeInfo(cell.sessionType);
  const timeRange = `${TOOLTIP_TIME_FORMAT.format(cell.startTime)}–${TOOLTIP_TIME_FORMAT.format(cell.endTime)}`;
  const name = cell.description ? `${cell.description} (${info.label})` : info.label;
  return [
    `${name} · ${timeRange}`,
    `Model: ${describeModel(cell)}`,
    `Host: ${cell.hostUsername ? memberLabel(cell.hostDisplayName, cell.hostUsername) : "Open — needs a host"}`,
    `${cell.bookedCount}/${cell.maxCapacity} booked`,
  ].join("\n");
}

/** Whether the cell should render as a normal, clickable session (vs. dimmed/disabled). */
export function isCellInteractive(status: SessionStatus): boolean {
  return status !== "TooFarFuture";
}

export type CellVariant = "open" | "yours" | "gone" | "locked";

/**
 * Four states (Design Philosophy.dc.html §03), shared by SessionCell.tsx
 * (the grid) and ScheduleAgenda.tsx (the mobile list) so the two surfaces
 * can't drift into classifying the same status differently — a lesson this
 * codebase has hit before with a series/generic booking path silently
 * diverging (see CLAUDE.md's booking implementation notes).
 */
export function variantFor(status: SessionStatus): CellVariant {
  switch (status) {
    case "Registered":
    case "CancelableNoRefund":
      return "yours";
    case "Full":
    case "OnWaitlist":
      return "gone";
    case "TooFarFuture":
      return "locked";
    default:
      // "Available" — NoSession is never passed in here, both surfaces
      // filter it out before reaching a variant-classified render.
      return "open";
  }
}

/** The date a Locked cell's session will enter the viewer's own booking
 * window — null once windowDays is Infinity (ADMIN, where TooFarFuture
 * never actually occurs, so there's nothing meaningful to compute). */
export function opensOnDate(cell: GridCellData, windowDays: number): Date | null {
  return Number.isFinite(windowDays)
    ? new Date(cell.startTime.getTime() - windowDays * 24 * 60 * 60 * 1000)
    : null;
}

// week=0 cells omit the param entirely (plain `?session_id=X`, exactly what
// every pre-pagination e2e test and Server Action redirect already expects)
// — only a genuinely paginated cell needs it, appended after session_id so
// the common case's exact string never changes. Shared by ScheduleGrid.tsx
// and ScheduleAgenda.tsx — both link into the same modal the same way.
export function cellHref(sessionId: string, weekOffset: number): string {
  return weekOffset === 0 ? `?session_id=${sessionId}` : `?session_id=${sessionId}&week=${weekOffset}`;
}

/**
 * bookSession/bookSeriesSeat (src/lib/booking/actions.ts, src/lib/series/actions.ts)
 * return a `reason` discriminant on failure. It used to be shown to members
 * completely raw (e.g. "Couldn't complete that: no-pass") via the
 * bookingError query param — this is the one place that translates it into
 * an actual sentence, reused by SessionDetailsPanel and SeriesPanel so
 * neither renders an internal code again. Reason codes themselves are
 * untouched by the pass -> ticket copy rename; only their English changed.
 */
const BOOKING_ERROR_REASONS: Record<string, string> = {
  "not-verified": "Verify your email before booking.",
  "no-pass": "You don't have a ticket available for this session.",
  full: "This session is full.",
  "already-booked": "You're already booked into this session.",
  "not-found": "That session couldn't be found.",
  "too-far": "This session isn't open for your booking window yet.",
  "seat-taken": "That seat was just taken — pick another.",
  "different-seat-already-held": "You already hold a different seat in this series.",
  "no-dates": "Pick at least one date.",
};

export function describeBookingErrorReason(reason: string): string {
  return BOOKING_ERROR_REASONS[reason] ?? "Couldn't complete that. Please try again.";
}
