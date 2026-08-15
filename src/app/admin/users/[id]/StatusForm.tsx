"use client";

import { useActionState } from "react";
import { setAccountStatusAction, type ActionState } from "./actions";

const STATUSES = ["Active", "Suspended", "Banned"] as const;
const initialState: ActionState = {};

export function StatusForm({ userId, currentStatus }: { userId: string; currentStatus: string }) {
  const [state, formAction, pending] = useActionState(setAccountStatusAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="status-select">Status</label>
      <select id="status-select" name="status" defaultValue={currentStatus}>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label htmlFor="status-reason">Reason (required)</label>
      <input id="status-reason" name="reason" required />
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Update status"}
      </button>
      <p>
        <em>
          Changing to Suspended or Banned automatically cancels this user&apos;s upcoming bookings and
          frees the seats.
        </em>
      </p>
    </form>
  );
}
