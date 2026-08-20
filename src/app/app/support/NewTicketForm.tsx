"use client";

import { useActionState } from "react";
import { createTicketAction, type CreateTicketState } from "@/lib/support/actions";

export function NewTicketForm() {
  const [state, formAction, pending] = useActionState<CreateTicketState, FormData>(createTicketAction, {});

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="new-ticket-subject">Subject</label>
      <input id="new-ticket-subject" name="subject" required />

      <label htmlFor="new-ticket-message">Message</label>
      <textarea id="new-ticket-message" name="message" rows={5} required />

      <button type="submit" disabled={pending}>
        Submit ticket
      </button>
    </form>
  );
}
