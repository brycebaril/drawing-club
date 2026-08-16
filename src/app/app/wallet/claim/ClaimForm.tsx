"use client";

import { useActionState } from "react";
import { claimPassAction, type ClaimPassState } from "./actions";

const initialState: ClaimPassState = {};

export function ClaimForm({ code }: { code?: string }) {
  const [state, formAction, pending] = useActionState(claimPassAction, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <div>
        <label htmlFor="claim-code">Claim code</label>
        <input id="claim-code" name="code" defaultValue={code ?? ""} required />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Claiming…" : "Claim & Add Pass to My Account"}
      </button>
    </form>
  );
}
