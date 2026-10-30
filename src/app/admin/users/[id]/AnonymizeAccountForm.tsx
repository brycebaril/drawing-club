"use client";

import { useActionState } from "react";
import { anonymizeAccountAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function AnonymizeAccountForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(anonymizeAccountAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="anonymize-reason">Reason (required)</label>
      <input id="anonymize-reason" name="reason" required />
      <p>
        <label>
          <input type="checkbox" id="anonymize-confirm" name="confirm" required /> I understand this
          permanently scrubs this account&rsquo;s email, username, and display name, and cannot be
          undone.
        </label>
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Anonymizing…" : "Anonymize & close account"}
      </button>
    </form>
  );
}
