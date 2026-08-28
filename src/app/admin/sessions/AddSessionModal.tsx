"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createSessionAction,
  createRecurrenceRuleAction,
  createSeriesAction,
  type CreateSessionState,
  type CreateRecurrenceRuleState,
  type CreateSeriesState,
} from "./actions";
import { SESSION_TYPES, SLOTS, SLOT_TIMES, DAYS_OF_WEEK, toDateOnly, parseDateOnly, type Slot } from "@/lib/sessions/shared";
import { HostSelect } from "@/components/HostSelect";
import type { HostCandidate } from "@/lib/sessions/host";

type AddType = "one-off" | "recurring" | "series";

const initialSessionState: CreateSessionState = {};
const initialRuleState: CreateRecurrenceRuleState = {};
const initialSeriesState: CreateSeriesState = {};

interface SeriesSlot {
  date: string;
  slot: Slot;
}

export function AddSessionModal({
  date,
  slot,
  hostCandidates,
  defaultCapacity,
  defaultSeatCount,
  onClose,
}: {
  date: Date;
  slot: Slot;
  hostCandidates: HostCandidate[];
  defaultCapacity: number;
  defaultSeatCount: number;
  onClose: () => void;
}) {
  const [type, setType] = useState<AddType>("one-off");
  const dateStr = toDateOnly(date);
  const times = SLOT_TIMES[slot];
  const dayLabel = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const [sessionState, sessionFormAction, sessionPending] = useActionState(createSessionAction, initialSessionState);
  const [ruleState, ruleFormAction, rulePending] = useActionState(createRecurrenceRuleAction, initialRuleState);
  const [seriesState, seriesFormAction, seriesPending] = useActionState(createSeriesAction, initialSeriesState);

  const [seriesSlots, setSeriesSlots] = useState<SeriesSlot[]>([{ date: dateStr, slot }]);
  const [extraDate, setExtraDate] = useState("");
  const [extraSlot, setExtraSlot] = useState<Slot>(slot);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function addSeriesSlot() {
    if (!extraDate) return;
    const key = `${extraDate}|${extraSlot}`;
    if (seriesSlots.some((s) => `${s.date}|${s.slot}` === key)) return;
    setSeriesSlots((prev) =>
      // Chronological, not a plain string sort on `${date}${slot}` — that
      // sorted "Afternoon" before "Evening" before "Morning" alphabetically
      // for a shared date, reversed from actual time-of-day order. SLOTS is
      // already declared in chronological order (Morning, Afternoon,
      // Evening), so its index is the real sort key.
      [...prev, { date: extraDate, slot: extraSlot }].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        return dateCompare !== 0 ? dateCompare : SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);
      }),
    );
    setExtraDate("");
  }

  function removeSeriesSlot(idx: number) {
    setSeriesSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Add a session" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2>Add a session</h2>
        <p className="section-note">
          {dayLabel} · {slot} ({times.start}–{times.end})
        </p>

        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={type === "one-off"}
            className={type === "one-off" ? "segmented-btn segmented-btn--active" : "segmented-btn"}
            onClick={() => setType("one-off")}
          >
            One-off
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={type === "recurring"}
            className={type === "recurring" ? "segmented-btn segmented-btn--active" : "segmented-btn"}
            onClick={() => setType("recurring")}
          >
            Recurring
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={type === "series"}
            className={type === "series" ? "segmented-btn segmented-btn--active" : "segmented-btn"}
            onClick={() => setType("series")}
          >
            Multi-week series
          </button>
        </div>

        {type === "one-off" && (
          <form action={sessionFormAction}>
            <div>
              <label htmlFor="qa-sessionType">Type</label>
              <select id="qa-sessionType" name="sessionType" defaultValue="R" required>
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qa-description">Description</label>
              <textarea id="qa-description" name="description" />
            </div>
            <div>
              <label htmlFor="qa-startTime">Start time</label>
              <input id="qa-startTime" name="startTime" type="datetime-local" defaultValue={`${dateStr}T${times.start}`} required />
            </div>
            <div>
              <label htmlFor="qa-endTime">End time</label>
              <input id="qa-endTime" name="endTime" type="datetime-local" defaultValue={`${dateStr}T${times.end}`} required />
            </div>
            <div>
              <label htmlFor="qa-maxCapacity">Capacity</label>
              <input id="qa-maxCapacity" name="maxCapacity" type="number" min={1} defaultValue={defaultCapacity} required />
            </div>
            <div>
              <label htmlFor="qa-hostUsername">Host</label>
              <HostSelect id="qa-hostUsername" candidates={hostCandidates} />
            </div>
            {sessionState.error && <p role="alert">{sessionState.error}</p>}
            <button type="submit" disabled={sessionPending}>
              {sessionPending ? "Creating…" : "Create session"}
            </button>
          </form>
        )}

        {type === "recurring" && (
          <form action={ruleFormAction}>
            <div>
              <label htmlFor="qr-sessionType">Type</label>
              <select id="qr-sessionType" name="sessionType" defaultValue="R" required>
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qr-description">Description</label>
              <textarea id="qr-description" name="description" />
            </div>
            <input type="hidden" name="dayOfWeek" value={date.getDay()} />
            <p className="section-note">Repeats every {DAYS_OF_WEEK[date.getDay()].label}, starting {dayLabel}.</p>
            <div>
              <label htmlFor="qr-startTimeOfDay">Start time</label>
              <input id="qr-startTimeOfDay" name="startTimeOfDay" type="time" defaultValue={times.start} required />
            </div>
            <div>
              <label htmlFor="qr-endTimeOfDay">End time</label>
              <input id="qr-endTimeOfDay" name="endTimeOfDay" type="time" defaultValue={times.end} required />
            </div>
            <div>
              <label htmlFor="qr-maxCapacity">Capacity (blank = default of {defaultCapacity})</label>
              <input id="qr-maxCapacity" name="maxCapacity" type="number" min={1} />
            </div>
            <div>
              <label htmlFor="qr-hostUsername">Host</label>
              <HostSelect id="qr-hostUsername" candidates={hostCandidates} />
            </div>
            <input type="hidden" name="startDate" value={dateStr} />
            <div>
              <label htmlFor="qr-endDate">End date (blank = repeats indefinitely)</label>
              <input id="qr-endDate" name="endDate" type="date" min={dateStr} />
            </div>
            {ruleState.error && <p role="alert">{ruleState.error}</p>}
            <button type="submit" disabled={rulePending}>
              {rulePending ? "Creating…" : "Create recurring session"}
            </button>
          </form>
        )}

        {type === "series" && (
          <form action={seriesFormAction}>
            <div>
              <label htmlFor="qs-name">Series name</label>
              <input id="qs-name" name="name" required />
            </div>
            <div>
              <label htmlFor="qs-sessionType">Type</label>
              <select id="qs-sessionType" name="sessionType" defaultValue="X" required>
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qs-description">Description</label>
              <textarea id="qs-description" name="description" />
            </div>
            <div>
              <label htmlFor="qs-seatCount">Seat count</label>
              <input id="qs-seatCount" name="seatCount" type="number" min={1} defaultValue={defaultSeatCount} required />
            </div>
            <div>
              <label htmlFor="qs-hostUsername">Host</label>
              <HostSelect id="qs-hostUsername" candidates={hostCandidates} />
            </div>

            <div>
              <p>Dates in this series</p>
              <ul className="chip-list">
                {seriesSlots.map((s, idx) => (
                  <li key={`${s.date}|${s.slot}`} className="chip">
                    <input type="hidden" name="slots" value={`${s.date}|${s.slot}`} />
                    {parseDateOnly(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {s.slot}
                    {seriesSlots.length > 1 && (
                      <button type="button" className="chip-remove" aria-label="Remove date" onClick={() => removeSeriesSlot(idx)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="chip-add">
                <input
                  type="date"
                  aria-label="Add another date"
                  value={extraDate}
                  min={toDateOnly(new Date())}
                  onChange={(e) => setExtraDate(e.target.value)}
                />
                <select aria-label="Slot for the added date" value={extraSlot} onChange={(e) => setExtraSlot(e.target.value as Slot)}>
                  {SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addSeriesSlot}>
                  + Add date
                </button>
              </div>
              <p className="section-note">
                Need many dates at once? Use the full{" "}
                <a href="/admin/sessions/new-series" target="_blank" rel="noreferrer">
                  multi-week series picker
                </a>{" "}
                instead.
              </p>
            </div>

            {seriesState.error && <p role="alert">{seriesState.error}</p>}
            <button type="submit" disabled={seriesPending}>
              {seriesPending ? "Creating…" : "Create series"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
