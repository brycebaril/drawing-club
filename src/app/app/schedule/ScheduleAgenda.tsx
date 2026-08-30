import Link from "next/link";
import { SLOTS, slotFor } from "@/lib/sessions/shared";
import {
  cellHref,
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

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const DATE_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

function AgendaRow({ cell, href, windowDays }: { cell: GridCellData; href: string; windowDays: number }) {
  const info = sessionTypeInfo(cell.sessionType);
  const interactive = isCellInteractive(cell.status);
  const variant = variantFor(cell.status);
  const showsNeedsModelFlag = cell.needsModel && (variant === "open" || variant === "yours");
  const spotsLeft = cell.maxCapacity - cell.bookedCount;
  const isMine = variant === "yours";
  const isOpen = cell.status === "Available";

  const fillClasses = showsNeedsModelFlag
    ? "border-2 border-dashed border-warn-line bg-warn-bg"
    : variant === "yours"
      ? "border-2 border-good-line bg-good-bg"
      : variant === "gone"
        ? "border border-line bg-ink-soft/10"
        : variant === "locked"
          ? "border border-dashed border-line/60 bg-canvas opacity-60"
          : "border border-line bg-panel";

  const glyphClass = showsNeedsModelFlag
    ? "text-warn"
    : variant === "yours"
      ? "text-good"
      : variant === "gone" || variant === "locked"
        ? "text-ink-soft"
        : info.textClass;

  let subtitle: string;
  if (variant === "locked") {
    const opensOn = opensOnDate(cell, windowDays);
    subtitle = opensOn ? `Opens ${formatOpensDate(opensOn)}` : "Not yet open";
  } else {
    const timeRange = `${formatCellTime(cell.startTime)}–${formatCellTime(cell.endTime)}`;
    if (showsNeedsModelFlag) {
      subtitle = `${timeRange} · model unconfirmed · ${Math.max(spotsLeft, 0)} left`;
    } else if (variant === "yours") {
      subtitle = `${timeRange} · ${describeModel(cell)} · Booked`;
    } else if (variant === "gone") {
      subtitle = `${timeRange} · Full — join waitlist`;
    } else {
      subtitle = `${timeRange} · ${Math.max(spotsLeft, 0)} left`;
    }
  }

  const content = (
    <div
      className={`flex min-h-[64px] items-center gap-3 rounded-lg px-3.5 py-2.5 shadow-sm transition-all duration-150 ${fillClasses} ${
        interactive ? "hover:shadow-md" : "cursor-not-allowed"
      }`}
    >
      <span className={`w-[30px] shrink-0 text-center text-2xl font-black leading-none ${glyphClass}`}>
        {info.display}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-ink">
          {info.label} · {slotFor(cell.startTime)}
        </div>
        <div className="truncate text-[12.5px] text-ink-soft">{subtitle}</div>
      </div>
    </div>
  );

  const tooltip = describeCellTooltip(cell);
  // agenda-row/data-mine/data-open live on the outermost element (the real
  // interactive unit — a Link when bookable, a disabled div otherwise) so
  // the pure-CSS filter's :has() rules in tailwind.css hide the whole row,
  // not just its visible content leaving an empty focusable shell behind.

  if (!interactive) {
    return (
      <div
        className="agenda-row block"
        data-mine={isMine}
        data-open={isOpen}
        aria-label={`${info.label} session — not yet open for your booking window`}
        aria-disabled="true"
        title={tooltip}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="agenda-row block"
      data-mine={isMine}
      data-open={isOpen}
      aria-label={`View ${info.label} session`}
      title={tooltip}
    >
      {content}
    </Link>
  );
}

/**
 * The mobile alternative to ScheduleGrid — Design Philosophy.dc.html §06
 * "Option A": days stack, only days with sessions appear, an All/Mine/Open
 * filter. Swapped in below 824px purely by CSS (see page.tsx's
 * `min-[824px]:` wrapper classes), so this stays a plain Server Component
 * consuming the exact same `grid`/`days` data ScheduleGrid does — no client
 * bundle, no risk of the two surfaces disagreeing about what a session's
 * state means. The filter itself is pure CSS too: three radio inputs plus
 * `:has()` rules in tailwind.css, not client JS.
 */
export function ScheduleAgenda({
  days,
  grid,
  windowDays,
  weekOffset,
}: {
  days: Date[];
  grid: Map<string, GridCellData>;
  windowDays: number;
  weekOffset: number;
}) {
  const dayGroups = days
    .map((d, dayIdx) => ({
      date: d,
      isToday: weekOffset === 0 && dayIdx === 0,
      cells: SLOTS.map((slot) => grid.get(`${dayIdx}:${slot}`)).filter((c): c is GridCellData => c !== undefined),
    }))
    .filter((group) => group.cells.length > 0); // only days with sessions appear

  return (
    <div className="agenda-filter-scope rounded-lg border border-line bg-panel p-4 shadow-sm">
      <fieldset className="mb-4 flex gap-2 border-0 p-0">
        <legend className="sr-only">Filter sessions</legend>
        <input type="radio" name="agenda-filter" id="agenda-filter-all" className="peer/all sr-only" defaultChecked />
        <input type="radio" name="agenda-filter" id="agenda-filter-mine" className="peer/mine sr-only" />
        <input type="radio" name="agenda-filter" id="agenda-filter-open" className="peer/open sr-only" />
        <label
          htmlFor="agenda-filter-all"
          className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft peer-checked/all:border-brand peer-checked/all:bg-brand peer-checked/all:text-white"
        >
          All
        </label>
        <label
          htmlFor="agenda-filter-mine"
          className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft peer-checked/mine:border-brand peer-checked/mine:bg-brand peer-checked/mine:text-white"
        >
          Mine
        </label>
        <label
          htmlFor="agenda-filter-open"
          className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft peer-checked/open:border-brand peer-checked/open:bg-brand peer-checked/open:text-white"
        >
          Open
        </label>
      </fieldset>

      {dayGroups.length === 0 && <p className="text-sm text-ink-soft">Nothing scheduled this week.</p>}

      <div className="space-y-4">
        {dayGroups.map((group) => (
          <div key={group.date.toISOString()} className="agenda-day">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-base font-black text-ink" style={{ fontFamily: "var(--font-heading)" }}>
                {group.isToday ? "Today" : DAY_LABEL_FORMAT.format(group.date)}
              </span>
              <span className="text-xs font-semibold text-ink-soft">{DATE_LABEL_FORMAT.format(group.date)}</span>
            </div>
            <div className="space-y-2">
              {group.cells.map((cell) => (
                <AgendaRow key={cell.id} cell={cell} href={cellHref(cell.id, weekOffset)} windowDays={windowDays} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
