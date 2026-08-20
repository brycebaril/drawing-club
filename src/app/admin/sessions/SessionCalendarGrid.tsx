"use client";

import { useState } from "react";
import Link from "next/link";
import { SLOTS, type Slot } from "@/lib/sessions/shared";
import type { HostCandidate } from "@/lib/sessions/host";
import { AddSessionModal } from "./AddSessionModal";

export interface OccupiedCell {
  sessionId: string;
  sessionType: string;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * A day x slot grid over the admin sessions window (see page.tsx's
 * GRID_WINDOW_DAYS) — an occupied cell links to that session's existing
 * Manage page; an open cell is a "+" button that opens AddSessionModal,
 * pre-filled with the clicked date/slot. Client-side (not the query-param
 * deep-linking convention /app/schedule's Modal uses) on purpose: this modal
 * has real interactive state (a type tab-switcher, a growable list of series
 * dates) that's worth instant switching rather than a round-trip per click,
 * and "which empty slot is currently open" isn't something worth bookmarking
 * the way an existing session's detail view is.
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
  const [picked, setPicked] = useState<{ date: Date; slot: Slot } | null>(null);

  return (
    <>
      <div className="table-scroll">
        <table className="calendar-grid">
          <thead>
            <tr>
              <th>Slot</th>
              {days.map((d) => (
                <th key={d.toISOString()}>
                  <span className="calendar-grid-weekday">{WEEKDAY_FORMAT.format(d)}</span>
                  <br />
                  {DAY_FORMAT.format(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <th>{slot}</th>
                {days.map((d, dayIdx) => {
                  const cell = occupied[`${dayIdx}:${slot}`];
                  return (
                    <td key={dayIdx}>
                      {cell ? (
                        <Link href={`/admin/sessions/${cell.sessionId}`} className="grid-cell grid-cell--filled">
                          {cell.sessionType}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="grid-cell grid-cell--empty"
                          aria-label={`Add a session on ${d.toLocaleDateString()} (${slot})`}
                          onClick={() => setPicked({ date: d, slot })}
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

      {picked && (
        <AddSessionModal
          date={picked.date}
          slot={picked.slot}
          hostCandidates={hostCandidates}
          defaultCapacity={defaultCapacity}
          defaultSeatCount={defaultSeatCount}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}
