import type { SessionStatus } from "@/lib/booking/sessionStatus";

export interface SessionTypeInfo {
  label: string;
  display: string;
  textClass: string;
}

// Each session_type gets a distinct hue from the schedule's own warm,
// muted category palette (tailwind.css's --color-type-* tokens) — analogous
// to the site's terracotta accent, not Tailwind's stock blue/purple/indigo.
export const SESSION_TYPE_INFO: Record<string, SessionTypeInfo> = {
  L: { label: "Long Pose", display: "L", textClass: "text-type-l" },
  R: { label: "Regular", display: "R", textClass: "text-type-r" },
  G: { label: "Gesture", display: "G", textClass: "text-type-g" },
  P: { label: "Portrait", display: "P", textClass: "text-type-p" },
  S: { label: "Special", display: "S", textClass: "text-type-s" },
  X: { label: "Extra Long Pose", display: "X", textClass: "text-type-x" },
  Gallery: { label: "Gallery Hours", display: "Ga", textClass: "text-type-gallery" },
  Party: { label: "Party", display: "Pa", textClass: "text-type-party" },
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
  modelRequired: boolean;
  modelNames: string | null;
  bookedCount: number;
  maxCapacity: number;
}

const TOOLTIP_TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function describeModel(cell: GridCellData): string {
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
    `Host: ${cell.hostUsername ?? "Open — needs a host"}`,
    `${cell.bookedCount}/${cell.maxCapacity} booked`,
  ].join("\n");
}

/** Whether the cell should render as a normal, clickable session (vs. dimmed/disabled). */
export function isCellInteractive(status: SessionStatus): boolean {
  return status !== "TooFarFuture";
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
