"use client";

import { useState } from "react";
import { SLOTS, toDateOnly, type Slot } from "@/lib/sessions/shared";
import type { HostCandidate } from "@/lib/sessions/host";
import { AddSessionModal } from "./AddSessionModal";
import { EditSessionModal } from "./EditSessionModal";

export interface OccupiedCell {
  sessionId: string;
  sessionType: string;
  needsHost: boolean;
  needsModel: boolean;
}

type ModalState = { kind: "add"; date: Date; slot: Slot } | { kind: "edit"; sessionId: string } | null;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * A day x slot grid over the admin sessions window (see page.tsx's
 * GRID_WINDOW_DAYS) — a filled cell opens EditSessionModal (the full
 * /admin/sessions/[id] content, reproduced in a modal rather than
 * navigating away, per explicit user request); an open cell opens
 * AddSessionModal, pre-filled with the clicked date/slot. Both are client-
 * side (not the query-param deep-linking convention /app/schedule's Modal
 * uses) on purpose: real interactive state (a type tab-switcher, a growable
 * list of series dates) is worth instant switching rather than a round-trip
 * per click, and "which cell is currently open" isn't worth bookmarking the
 * way, say, a wallet transfer's modal state is.
 */
export function SessionCalendarGrid({
  days,
  occupied,
  hostCandidates,
  defaultCapacity,
  defaultSeatCount,
}: {
  days: Date[];
  occupied: Record<string, OccupiedCell>;
  hostCandidates: HostCandidate[];
  defaultCapacity: number;
  defaultSeatCount: number;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const todayStr = toDateOnly(new Date());

  return (
    <>
      <div className="table-scroll">
        <table className="calendar-grid">
          <thead>
            <tr>
              <th>Slot</th>
              {days.map((d) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isToday = toDateOnly(d) === todayStr;
                return (
                  <th
                    key={d.toISOString()}
                    className={`${isWeekend ? "calendar-grid-weekend" : ""}${isToday ? " calendar-grid-today" : ""}`}
                  >
                    <span className="calendar-grid-weekday">{WEEKDAY_FORMAT.format(d)}</span>
                    <br />
                    {DAY_FORMAT.format(d)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <th>{slot}</th>
                {days.map((d, dayIdx) => {
                  const cell = occupied[`${dayIdx}:${slot}`];
                  const incomplete = cell && (cell.needsHost || cell.needsModel);
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <td key={dayIdx} className={isWeekend ? "calendar-grid-weekend" : ""}>
                      {cell ? (
                        <button
                          type="button"
                          className={`grid-cell grid-cell--filled${incomplete ? " grid-cell--incomplete" : ""}`}
                          aria-label={`Edit ${cell.sessionType} session on ${d.toLocaleDateString()} (${slot})`}
                          onClick={() => setModal({ kind: "edit", sessionId: cell.sessionId })}
                        >
                          {cell.needsModel && (
                            <span className="grid-cell-flag grid-cell-flag--model" title="Needs a model">
                              M
                            </span>
                          )}
                          {cell.needsHost && (
                            <span className="grid-cell-flag grid-cell-flag--host" title="Needs a host">
                              H
                            </span>
                          )}
                          {cell.sessionType}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="grid-cell grid-cell--empty"
                          aria-label={`Add a session on ${d.toLocaleDateString()} (${slot})`}
                          onClick={() => setModal({ kind: "add", date: d, slot })}
                        >
                          +
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.kind === "add" && (
        <AddSessionModal
          date={modal.date}
          slot={modal.slot}
          hostCandidates={hostCandidates}
          defaultCapacity={defaultCapacity}
          defaultSeatCount={defaultSeatCount}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === "edit" && (
        <EditSessionModal sessionId={modal.sessionId} hostCandidates={hostCandidates} onClose={() => setModal(null)} />
      )}
    </>
  );
}
