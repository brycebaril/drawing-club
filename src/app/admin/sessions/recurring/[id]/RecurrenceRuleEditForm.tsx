"use client";

import { useActionState, useState } from "react";
import { editRecurrenceRuleAction, type EditRecurrenceRuleState } from "./actions";
import { SESSION_TYPES, DAYS_OF_WEEK } from "@/lib/sessions/shared";

const initialState: EditRecurrenceRuleState = {};

interface Props {
  ruleId: string;
  defaultCapacity: number;
  rule: {
    sessionType: string;
    description: string;
    dayOfWeek: number;
    startTimeOfDay: string;
    endTimeOfDay: string;
    maxCapacity: string;
    hostUsername: string;
    startDate: string;
    endDate: string;
  };
}

export function RecurrenceRuleEditForm({ ruleId, defaultCapacity, rule }: Props) {
  const [state, formAction, pending] = useActionState(editRecurrenceRuleAction, initialState);
  const [scopeType, setScopeType] = useState<"entire" | "this-and-future">("entire");

  return (
    <form action={formAction}>
      <input type="hidden" name="ruleId" value={ruleId} />
      <div>
        <label htmlFor="rre-sessionType">Type</label>
        <select id="rre-sessionType" name="sessionType" defaultValue={rule.sessionType} required>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rre-description">Description</label>
        <textarea id="rre-description" name="description" defaultValue={rule.description} />
      </div>
      <div>
        <label htmlFor="rre-dayOfWeek">Day of week</label>
        <select id="rre-dayOfWeek" name="dayOfWeek" defaultValue={String(rule.dayOfWeek)} required>
          {DAYS_OF_WEEK.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rre-startTimeOfDay">Start time</label>
        <input
          id="rre-startTimeOfDay"
          name="startTimeOfDay"
          type="time"
          defaultValue={rule.startTimeOfDay}
          required
        />
      </div>
      <div>
        <label htmlFor="rre-endTimeOfDay">End time</label>
        <input id="rre-endTimeOfDay" name="endTimeOfDay" type="time" defaultValue={rule.endTimeOfDay} required />
      </div>
      <div>
        <label htmlFor="rre-maxCapacity">Capacity (blank = default of {defaultCapacity})</label>
        <input id="rre-maxCapacity" name="maxCapacity" type="number" min={1} defaultValue={rule.maxCapacity} />
      </div>
      <div>
        <label htmlFor="rre-hostUsername">Host username (optional — leave blank for an open host slot)</label>
        <input id="rre-hostUsername" name="hostUsername" defaultValue={rule.hostUsername} />
      </div>
      <div>
        <label htmlFor="rre-startDate">Start date</label>
        <input id="rre-startDate" name="startDate" type="date" defaultValue={rule.startDate} required />
      </div>
      <div>
        <label htmlFor="rre-endDate">End date (blank = repeats indefinitely)</label>
        <input id="rre-endDate" name="endDate" type="date" defaultValue={rule.endDate} />
      </div>

      <fieldset>
        <legend>Apply changes to</legend>
        <p role="alert">
          Occurrences with existing bookings in the affected range will be canceled, passes released, and
          booked members emailed.
        </p>
        <label htmlFor="rre-scopeEntire">
          <input
            id="rre-scopeEntire"
            type="radio"
            name="scopeType"
            value="entire"
            checked={scopeType === "entire"}
            onChange={() => setScopeType("entire")}
          />
          Entire rule (from today forward)
        </label>
        <div>
          <label htmlFor="rre-scopeThisAndFuture">
            <input
              id="rre-scopeThisAndFuture"
              type="radio"
              name="scopeType"
              value="this-and-future"
              checked={scopeType === "this-and-future"}
              onChange={() => setScopeType("this-and-future")}
            />
            From this date forward
          </label>
          <label htmlFor="rre-scopeFromDate">
            Date
            <input
              id="rre-scopeFromDate"
              type="date"
              name="scopeFromDate"
              disabled={scopeType !== "this-and-future"}
              required={scopeType === "this-and-future"}
              onFocus={() => setScopeType("this-and-future")}
            />
          </label>
        </div>
      </fieldset>

      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
