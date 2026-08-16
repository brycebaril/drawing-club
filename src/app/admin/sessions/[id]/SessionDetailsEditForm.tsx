"use client";

import { useActionState } from "react";
import { updateSessionDetailsAction, type UpdateSessionDetailsState } from "./actions";
import { SESSION_TYPES } from "@/lib/sessions/shared";

const initialState: UpdateSessionDetailsState = {};

export function SessionDetailsEditForm({
  sessionId,
  sessionType,
  description,
  maxCapacity,
  hostUsername,
}: {
  sessionId: string;
  sessionType: string;
  description: string;
  maxCapacity: number;
  hostUsername: string;
}) {
  const [state, formAction, pending] = useActionState(updateSessionDetailsAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <label htmlFor="sde-sessionType">Type</label>
        <select id="sde-sessionType" name="sessionType" defaultValue={sessionType} required>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sde-description">Description</label>
        <textarea id="sde-description" name="description" defaultValue={description} />
      </div>
      <div>
        <label htmlFor="sde-maxCapacity">Capacity</label>
        <input
          id="sde-maxCapacity"
          name="maxCapacity"
          type="number"
          min={1}
          defaultValue={maxCapacity}
          required
        />
      </div>
      <div>
        <label htmlFor="sde-hostUsername">Host username (optional — leave blank for an open host slot)</label>
        <input id="sde-hostUsername" name="hostUsername" defaultValue={hostUsername} />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
