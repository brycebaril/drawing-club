"use client";

import { useEffect } from "react";
import { ORG_TIMEZONE } from "@/lib/org";
import type { SessionCollisionOption } from "./SessionCalendarGrid";

/**
 * Shown instead of jumping straight to EditSessionModal when a calendar
 * cell has more than one session in it (a data-integrity anomaly —
 * createSessionAction has no slot-conflict check for one-off sessions, see
 * SessionCalendarGrid.tsx's own comment on OccupiedCell.others). Mirrors
 * EditSessionModal's own backdrop/panel/Escape-key structure rather than
 * inventing a new interaction pattern for what's otherwise a rare case.
 */
export function PickSessionModal({
  options,
  onPick,
  onClose,
}: {
  options: SessionCollisionOption[];
  onPick: (sessionId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Choose a session" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2>Multiple sessions in this slot</h2>
        <p className="section-note">This is a scheduling collision, not normal — pick one to manage.</p>
        <ul>
          {options.map((opt) => (
            <li key={opt.sessionId}>
              <button type="button" className="link-button" onClick={() => onPick(opt.sessionId)}>
                {opt.sessionType} —{" "}
                {new Date(opt.startTime).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: ORG_TIMEZONE,
                })}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
