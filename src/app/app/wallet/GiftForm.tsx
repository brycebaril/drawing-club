"use client";

import { useActionState } from "react";
import { sendGiftAction, type SendGiftState } from "./actions";

const initialState: SendGiftState = {};

export function GiftForm({ passId, disabled }: { passId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(sendGiftAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="passId" value={passId} />
      {state.error && <p role="alert">{state.error}</p>}
      <input name="recipientUsername" placeholder="Recipient username (optional)" />
      <input name="note" placeholder="Note (optional)" />
      <button type="submit" disabled={pending || disabled}>
        {pending ? "Sending…" : "Send gift"}
      </button>
    </form>
  );
}
