"use client";

import { useActionState } from "react";
import { cancelTransferAction, type TransferActionState } from "./actions";

const initialState: TransferActionState = {};

export function CancelTransferButton({ passId }: { passId: string }) {
  const [state, formAction, pending] = useActionState(cancelTransferAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="passId" value={passId} />
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel"}
      </button>
    </form>
  );
}
