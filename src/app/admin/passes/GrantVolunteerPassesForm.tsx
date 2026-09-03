"use client";

import { useActionState } from "react";
import { grantVolunteerPassesAction, type GrantVolunteerPassesState } from "./actions";

const initialState: GrantVolunteerPassesState = {};

export function GrantVolunteerPassesForm() {
  const [state, formAction, pending] = useActionState(grantVolunteerPassesAction, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      {state.weekStart && (
        <p role="status">
          Week of {state.weekStart}: {state.granted} volunteer(s) granted, {state.skippedAtCap} at/above cap,{" "}
          {state.alreadyGranted} already granted this week.
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Granting…" : "Grant this week's volunteer tickets"}
      </button>
    </form>
  );
}
