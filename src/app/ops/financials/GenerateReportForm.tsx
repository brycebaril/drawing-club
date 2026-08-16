"use client";

import { useActionState } from "react";
import { generateReportAction, type GenerateReportState } from "./actions";

const initialState: GenerateReportState = {};

export function GenerateReportForm({ defaultWeekStart }: { defaultWeekStart: string }) {
  const [state, formAction, pending] = useActionState(generateReportAction, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <label htmlFor="week-start">Week start (must be a Monday)</label>
      <input id="week-start" name="weekStart" type="date" defaultValue={defaultWeekStart} required />
      <button type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate this week's report"}
      </button>
    </form>
  );
}
