import Link from "next/link";
import { CheckCircle2, Clock, Lock, UserX } from "lucide-react";
import { describeCellTooltip, isCellInteractive, sessionTypeInfo, type GridCellData } from "./scheduleTypes";

export function EmptyCell() {
  return (
    <div
      className="aspect-square w-11 shrink-0 rounded-lg border border-line bg-canvas opacity-60"
      title="No session scheduled"
    />
  );
}

export function SessionCell({ cell, href }: { cell: GridCellData; href: string }) {
  const info = sessionTypeInfo(cell.sessionType);
  const interactive = isCellInteractive(cell.status);
  const isMine = cell.status === "Registered" || cell.status === "CancelableNoRefund";

  // Matches globals.css's button:disabled opacity (0.5) rather than an
  // invented value — "not yet in your booking window" is this page's one
  // disabled-ish state.
  const stateClasses = !interactive
    ? "border border-line bg-canvas opacity-50 grayscale cursor-not-allowed"
    : isMine
      ? "border-2 border-good-line bg-good-bg ring-2 ring-good-line/40 hover:shadow-md hover:-translate-y-0.5"
      : cell.needsModel
        ? "border-2 border-dashed border-warn-line bg-warn-bg hover:shadow-md hover:-translate-y-0.5"
        : "border border-line bg-panel hover:border-brand hover:shadow-md hover:-translate-y-0.5";

  const content = (
    <div
      className={`relative aspect-square w-11 shrink-0 flex flex-col items-center justify-center rounded-lg shadow-sm transition-all duration-150 ${stateClasses}`}
    >
      {cell.needsModel && interactive && (
        <span className="absolute top-1 left-1" title="No model assigned yet">
          <UserX className="h-3 w-3 text-warn" strokeWidth={2.5} />
        </span>
      )}
      {isMine && (
        <span className="absolute top-1 right-1" title="You're registered">
          <CheckCircle2 className="h-3 w-3 text-good" fill="currentColor" />
        </span>
      )}
      {cell.status === "OnWaitlist" && (
        <span className="absolute top-1 right-1" title="You're on the waitlist">
          <Clock className="h-3 w-3 text-warn" strokeWidth={2.5} />
        </span>
      )}
      <span className={`text-lg font-black ${info.textClass}`}>{info.display}</span>
      {cell.status === "CancelableNoRefund" && (
        <span
          className="absolute bottom-1 right-1 rounded-full bg-panel p-px"
          title="Canceling now won't refund your ticket"
        >
          <Lock className="h-2.5 w-2.5 text-warn" strokeWidth={3} />
        </span>
      )}
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
