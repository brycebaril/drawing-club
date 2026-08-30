import Link from "next/link";
import {
  describeCellTooltip,
  describeModel,
  formatCellTime,
  formatOpensDate,
  isCellInteractive,
  opensOnDate,
  sessionTypeInfo,
  variantFor,
  type GridCellData,
} from "./scheduleTypes";

// 92x88 — Design Philosophy.dc.html §03/§04: three lines (type letter, model,
// start time + state), sized to hold real text rather than the compact
// icon-badge cell this replaces.
const CELL_SIZE = "h-[88px] w-[92px]";

export function EmptyCell() {
  return (
    <div
      className={`${CELL_SIZE} shrink-0 rounded-lg border border-dashed border-line/60 bg-canvas`}
      title="No session scheduled"
    />
  );
}

/**
 * Four states + one flag (Design Philosophy.dc.html §03), replacing the
 * previous seven-state/four-corner-icon cell. Colour is never the only
 * signal: every variant differs in fill, border weight, border style AND
 * wording, not hue alone — readable in greyscale. The needsModel flag is
 * the one thing that ever layers on top, and only over Open/Yours (a Gone
 * or Locked cell never shows it, even if the underlying session still
 * technically needs a model) — matching the doc's own explicit rule.
 */
export function SessionCell({ cell, href, windowDays }: { cell: GridCellData; href: string; windowDays: number }) {
  const info = sessionTypeInfo(cell.sessionType);
  const interactive = isCellInteractive(cell.status);
  const variant = variantFor(cell.status);
  const showsNeedsModelFlag = cell.needsModel && (variant === "open" || variant === "yours");
  const spotsLeft = cell.maxCapacity - cell.bookedCount;

  const fillClasses = showsNeedsModelFlag
    ? "border-2 border-dashed border-warn-line bg-warn-bg"
    : variant === "yours"
      ? "border-2 border-good-line bg-good-bg"
      : variant === "gone"
        ? "border border-line bg-ink-soft/10"
        : variant === "locked"
          ? "border border-dashed border-line/60 bg-canvas opacity-60"
          : "border border-line bg-panel"; // open, no flag

  const glyphClass = showsNeedsModelFlag
    ? "text-warn"
    : variant === "yours"
      ? "text-good"
      : variant === "gone" || variant === "locked"
        ? "text-ink-soft"
        : info.textClass;

  const middleLine = showsNeedsModelFlag ? "no model yet" : describeModel(cell);
  const middleLineClass = showsNeedsModelFlag ? "text-warn" : "text-ink-soft";

  let bottomLine: string;
  if (variant === "locked") {
    const opensOn = opensOnDate(cell, windowDays);
    bottomLine = opensOn ? `Opens ${formatOpensDate(opensOn)}` : "Not yet open";
  } else if (variant === "yours") {
    bottomLine = `${formatCellTime(cell.startTime)} · Booked`;
  } else if (variant === "gone") {
    bottomLine = `${formatCellTime(cell.startTime)} · Full`;
  } else {
    bottomLine = `${formatCellTime(cell.startTime)} · ${Math.max(spotsLeft, 0)} left`;
  }

  const content = (
    <div
      className={`${CELL_SIZE} shrink-0 flex flex-col items-center justify-center gap-px rounded-lg px-1 text-center shadow-sm transition-all duration-150 ${fillClasses} ${
        interactive ? "hover:shadow-md hover:-translate-y-0.5" : "cursor-not-allowed"
      }`}
    >
      <span className={`text-3xl font-black leading-none ${glyphClass}`}>{info.display}</span>
      <span className={`w-full truncate text-[11px] font-semibold leading-tight ${middleLineClass}`}>
        {middleLine}
      </span>
      <span className="w-full truncate text-[11px] font-bold leading-tight text-ink">{bottomLine}</span>
    </div>
  );

  const tooltip = describeCellTooltip(cell);

  if (!interactive) {
    return (
      <div
        aria-label={`${info.label} session — not yet open for your booking window`}
        aria-disabled="true"
        title={tooltip}
      >
        {content}
      </div>
    );
  }

  return (
    <Link href={href} aria-label={`View ${info.label} session`} title={tooltip}>
      {content}
    </Link>
  );
}
