"use client";

import { useActionState } from "react";
import { createSessionAction, type CreateSessionState } from "../actions";

const SESSION_TYPES = ["L", "R", "G", "P", "S", "X", "Gallery", "Party"] as const;

const initialState: CreateSessionState = {};

export function SessionForm({ defaultCapacity }: { defaultCapacity: number }) {
  const [state, formAction, pending] = useActionState(createSessionAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="sessionType">Type</label>
        <select id="sessionType" name="sessionType" defaultValue="R" required>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" />
      </div>
      <div>
        <label htmlFor="startTime">Start time</label>
        <input id="startTime" name="startTime" type="datetime-local" required />
      </div>
      <div>
        <label htmlFor="endTime">End time</label>
        <input id="endTime" name="endTime" type="datetime-local" required />
      </div>
      <div>
        <label htmlFor="maxCapacity">Capacity</label>
        <input
          id="maxCapacity"
          name="maxCapacity"
          type="number"
          min={1}
          defaultValue={defaultCapacity}
          required
        />
      </div>
      <div>
        <label htmlFor="hostUsername">Host username (optional — leave blank for an open host slot)</label>
        <input id="hostUsername" name="hostUsername" />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create session"}
      </button>
    </form>
  );
}
