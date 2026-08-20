"use client";

import { useActionState } from "react";
import { replyToTicketAction, type ReplyState } from "@/lib/support/actions";

/** Shared by /app/support/[id] (the requester) and /ops/support/[id] (staff) — replyToTicketAction re-derives who's allowed to post regardless of which page it's called from. */
export function ReplyForm({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState<ReplyState, FormData>(replyToTicketAction, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="ticketId" value={ticketId} />
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="reply-message">Reply</label>
      <textarea id="reply-message" name="message" rows={4} required />

      <button type="submit" disabled={pending}>
        Send reply
      </button>
    </form>
  );
}
