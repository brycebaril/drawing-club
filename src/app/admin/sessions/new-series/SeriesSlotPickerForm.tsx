"use client";

import { useActionState } from "react";
import { createSeriesAction, type CreateSeriesState } from "../actions";
import { SESSION_TYPES, SLOTS, toDateOnly } from "@/lib/sessions/shared";

const initialState: CreateSeriesState = {};

interface Props {
  days: Date[];
  occupied: Record<string, string>;
  defaultSeatCount: number;
}

export function SeriesSlotPickerForm({ days, occupied, defaultSeatCount }: Props) {
  const [state, formAction, pending] = useActionState(createSeriesAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="series-name">Series name</label>
        <input id="series-name" name="name" required />
      </div>
      <div>
        <label htmlFor="series-sessionType">Type</label>
        <select id="series-sessionType" name="sessionType" defaultValue="X" required>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="series-description">Description</label>
        <textarea id="series-description" name="description" />
      </div>
      <div>
        <label htmlFor="series-seatCount">Seat count</label>
        <input
          id="series-seatCount"
          name="seatCount"
          type="number"
          min={1}
          defaultValue={defaultSeatCount}
          required
        />
      </div>
      <div>
        <label htmlFor="series-hostUsername">Host username (optional — leave blank for an open host slot)</label>
        <input id="series-hostUsername" name="hostUsername" />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>Slot</th>
              {days.map((d) => (
                <th key={d.toISOString()}>
                  {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <th>{slot}</th>
                {days.map((d, dayIdx) => {
                  const bookedType = occupied[`${dayIdx}:${slot}`];
                  const dateStr = toDateOnly(d);
                  return (
                    <td key={dayIdx}>
                      {bookedType ? (
                        `Booked: ${bookedType}`
                      ) : (
                        <label>
                          <input type="checkbox" name="slots" value={`${dateStr}|${slot}`} />
                        </label>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create series"}
      </button>
    </form>
  );
}
