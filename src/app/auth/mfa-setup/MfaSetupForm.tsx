"use client";

import { useActionState } from "react";
import { confirmMfaAction, type MfaSetupState } from "./actions";

const initialState: MfaSetupState = {};

export function MfaSetupForm() {
  const [state, formAction, pending] = useActionState(confirmMfaAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="code">Enter the 6-digit code from your authenticator app</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Confirming…" : "Confirm & enable MFA"}
      </button>
    </form>
  );
}
