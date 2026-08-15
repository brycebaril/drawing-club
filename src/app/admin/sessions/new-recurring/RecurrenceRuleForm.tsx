"use client";

import { useActionState } from "react";
import { createRecurrenceRuleAction, type CreateRecurrenceRuleState } from "../actions";
import { SESSION_TYPES, DAYS_OF_WEEK } from "@/lib/sessions/shared";

const initialState: CreateRecurrenceRuleState = {};

export function RecurrenceRuleForm({ defaultCapacity }: { defaultCapacity: number }) {
  const [state, formAction, pending] = useActionState(createRecurrenceRuleAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="rr-sessionType">Type</label>
        <select id="rr-sessionType" name="sessionType" defaultValue="R" required>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rr-description">Description</label>
        <textarea id="rr-description" name="description" />
      </div>
      <div>
        <label htmlFor="rr-dayOfWeek">Day of week</label>
        <select id="rr-dayOfWeek" name="dayOfWeek" defaultValue="1" required>
          {DAYS_OF_WEEK.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rr-startTimeOfDay">Start time</label>
        <input id="rr-startTimeOfDay" name="startTimeOfDay" type="time" required />
      </div>
      <div>
        <label htmlFor="rr-endTimeOfDay">End time</label>
        <input id="rr-endTimeOfDay" name="endTimeOfDay" type="time" required />
      </div>
      <div>
        <label htmlFor="rr-maxCapacity">Capacity (blank = default of {defaultCapacity})</label>
        <input id="rr-maxCapacity" name="maxCapacity" type="number" min={1} />
      </div>
      <div>
        <label htmlFor="rr-hostUsername">Host username (optional — leave blank for an open host slot)</label>
        <input id="rr-hostUsername" name="hostUsername" />
      </div>
      <div>
        <label htmlFor="rr-startDate">Start date</label>
        <input id="rr-startDate" name="startDate" type="date" required />
      </div>
      <div>
        <label htmlFor="rr-endDate">End date (blank = repeats indefinitely)</label>
        <input id="rr-endDate" name="endDate" type="date" />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create recurring session"}
      </button>
    </form>
  );
}
