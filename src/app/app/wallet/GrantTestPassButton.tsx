"use client";

import { useActionState } from "react";
import { grantTestPassAction, type GrantTestPassState } from "./actions";

const initialState: GrantTestPassState = {};

export function GrantTestPassButton() {
  const [state, formAction, pending] = useActionState(grantTestPassAction, initialState);

  return (
    <form action={formAction}>
      <p>
        <em>Dev stand-in for Stripe Checkout — grants a free test pass directly.</em>
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Granting…" : "Get a test pass"}
      </button>
    </form>
  );
}
