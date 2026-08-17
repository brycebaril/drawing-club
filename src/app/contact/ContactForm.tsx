"use client";

import { useActionState } from "react";
import { sendContactMessageAction, type ContactFormState } from "./actions";

export function ContactForm() {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(
    sendContactMessageAction,
    {},
  );

  if (state.success) {
    return <p>Thanks — your message has been sent.</p>;
  }

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="name">Name</label>
      <input id="name" name="name" required />

      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required />

      <label htmlFor="message">Message</label>
      <textarea id="message" name="message" rows={6} required />

      {/* Honeypot — hidden from real visitors, left for bots to fill in. */}
      <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" disabled={pending}>
        Send
      </button>
    </form>
  );
}
