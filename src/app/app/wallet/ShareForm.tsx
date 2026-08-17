"use client";

import { useActionState } from "react";
import { sharePassAction, type SharePassState } from "./actions";

const initialState: SharePassState = {};

export function ShareForm({ passId, disabled }: { passId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(sharePassAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="passId" value={passId} />
      {state.error && <p role="alert">{state.error}</p>}
      <input name="recipientUsername" placeholder="Recipient username" required />
      <input name="note" placeholder="Note (optional)" />
      <button type="submit" disabled={pending || disabled}>
        {pending ? "Sharing…" : "Share"}
      </button>
    </form>
  );
}
