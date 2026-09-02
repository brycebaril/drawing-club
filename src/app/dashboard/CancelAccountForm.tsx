"use client";

import { useActionState } from "react";
import {
  requestCancellationAction,
  withdrawCancellationRequestAction,
  type ActionState,
} from "./actions";

const initialState: ActionState = {};

export function CancelAccountForm({
  requestedAt,
  reason,
}: {
  requestedAt: string | null;
  reason: string | null;
}) {
  const [state, formAction, pending] = useActionState(requestCancellationAction, initialState);

  if (requestedAt) {
    return (
      <div>
        <p role="alert">
          You requested account cancellation on {new Date(requestedAt).toLocaleDateString()}
          {reason && <> — &ldquo;{reason}&rdquo;</>}. An admin will review this request.
        </p>
        <form action={withdrawCancellationRequestAction}>
          <button type="submit">Withdraw request</button>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="cancel-reason">Why are you canceling?</label>
        <textarea id="cancel-reason" name="reason" required rows={3} />
      </div>
      <p>
        This submits a request for an admin to review — your account isn&rsquo;t closed
        immediately.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Request account cancellation"}
      </button>
    </form>
  );
}
