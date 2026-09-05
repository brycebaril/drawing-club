"use client";

import { useState } from "react";
import { SLOTS, toDateOnly, type Slot } from "@/lib/sessions/shared";
import type { HostCandidate } from "@/lib/sessions/host";
import { AddSessionModal } from "./AddSessionModal";
import { EditSessionModal } from "./EditSessionModal";
import { PickSessionModal } from "./PickSessionModal";
import { ORG_TIMEZONE } from "@/lib/org";
import { orgDateParts } from "@/lib/timezone";

export interface SessionCollisionOption {
  sessionId: string;
  sessionType: string;
  startTime: string;
}

export interface OccupiedCell {
  sessionId: string;
  sessionType: string;
  startTime: string;
  needsHost: boolean;
  needsModel: boolean;
  bookedCount: number;
  maxCapacity: number;
  /** Other sessions also landing in this day+slot cell (see page.tsx) — a
   * data-integrity anomaly (createSessionAction has no slot-conflict check
   * for one-off sessions), not a normal state. undefined/empty means just
   * the one shown. */
  others?: SessionCollisionOption[];
}

/**
 * The cell's one caption line — Design Philosophy.dc.html §07's admin
 * calendar: "admins get one extra flag the member grid never shows — no
 * host — and counts instead of 'left'. Same fills, same letters, so an
 * admin and a member can talk about the same cell." Wording matches
 * SessionCell.tsx's own "no model yet" exactly where both apply, rather
 * than inventing separate copy for the same fact on two different grids.
 *
 * extraCount (a same-cell collision — two sessions accidentally landing in
 * the same day+slot) is deliberately NOT folded in here: this line is
 * CSS-truncated to fit the cell (.grid-cell-caption, globals.css), and a
 * collision is a data-integrity anomaly, not a session state — it needs to
 * stay visible regardless of how long the state text is, so it renders as
 * its own small badge instead (see grid-cell-collision-badge below).
 */
function captionFor(cell: OccupiedCell): string {
  if (cell.needsModel && cell.needsHost) return "no model, no host";
  if (cell.needsModel) return "no model yet";
  if (cell.needsHost) return "no host";
  return `${cell.bookedCount}/${cell.maxCapacity}`;
}

type ModalState =
  | { kind: "add"; date: Date; slot: Slot }
  | { kind: "edit"; sessionId: string }
  | { kind: "pick"; options: SessionCollisionOption[] }
  | null;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: ORG_TIMEZONE });
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ORG_TIMEZONE });

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
                const isWeekend = orgDateParts(d).weekday === 0 || orgDateParts(d).weekday === 6;
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
                  const isWeekend = orgDateParts(d).weekday === 0 || orgDateParts(d).weekday === 6;
                  return (
                    <td key={dayIdx} className={isWeekend ? "calendar-grid-weekend" : ""}>
                      {cell ? (
                        <button
                          type="button"
                          className={`grid-cell grid-cell--filled${incomplete ? " grid-cell--incomplete" : ""}`}
                          aria-label={`Edit ${cell.sessionType} session on ${d.toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })} (${slot})${cell.others?.length ? ` — ${cell.others.length} more session(s) also scheduled in this slot` : ""}`}
                          onClick={() =>
                            cell.others?.length
                              ? setModal({
                                  kind: "pick",
                                  options: [
                                    { sessionId: cell.sessionId, sessionType: cell.sessionType, startTime: cell.startTime },
                                    ...cell.others,
                                  ],
                                })
                              : setModal({ kind: "edit", sessionId: cell.sessionId })
                          }
                        >
                          <span className="grid-cell-glyph">{cell.sessionType}</span>
                          <span className="grid-cell-caption">{captionFor(cell)}</span>
                          {!!cell.others?.length && (
                            <span
                              className="grid-cell-collision-badge"
                              title={`${cell.others.length} more session(s) also scheduled in this slot`}
                            >
                              +{cell.others.length}
                            </span>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="grid-cell grid-cell--empty"
                          aria-label={`Add a session on ${d.toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })} (${slot})`}
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

      {modal?.kind === "pick" && (
        <PickSessionModal
          options={modal.options}
          onPick={(sessionId) => setModal({ kind: "edit", sessionId })}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
