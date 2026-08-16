"use client";

import { useActionState } from "react";
import { revokeGiftAction, type RevokeGiftState } from "./actions";

const initialState: RevokeGiftState = {};

export function RevokeGiftButton({ passId }: { passId: string }) {
  const [state, formAction, pending] = useActionState(revokeGiftAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="passId" value={passId} />
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </button>
    </form>
  );
}
