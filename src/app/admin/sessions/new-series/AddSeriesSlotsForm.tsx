"use client";

import { useActionState } from "react";
import { addSeriesSlotsAction, type AddSeriesSlotsState } from "@/app/admin/sessions/series/[id]/actions";
import { SESSION_TYPES, SLOTS, toDateOnly } from "@/lib/sessions/shared";

const initialState: AddSeriesSlotsState = {};

interface Props {
  seriesId: string;
  days: Date[];
  occupied: Record<string, string>;
}

export function AddSeriesSlotsForm({ seriesId, days, occupied }: Props) {
  const [state, formAction, pending] = useActionState(addSeriesSlotsAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="seriesId" value={seriesId} />
      <div>
        <label htmlFor="ass-sessionType">Type</label>
        <select id="ass-sessionType" name="sessionType" defaultValue="X" required>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ass-description">Description</label>
        <textarea id="ass-description" name="description" />
      </div>
      <div>
        <label htmlFor="ass-hostUsername">Host username (optional — leave blank for an open host slot)</label>
        <input id="ass-hostUsername" name="hostUsername" />
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
        {pending ? "Adding…" : "Add dates to series"}
      </button>
    </form>
  );
}
