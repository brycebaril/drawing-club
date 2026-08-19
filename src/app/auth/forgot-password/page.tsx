"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = {};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.submitted) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>If an account matches what you entered, we&rsquo;ve sent a password reset link to its email address.</p>
        <p>
          <a href="/auth/login">Back to log in</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Reset your password</h1>
      <form action={formAction}>
        <div>
          <label htmlFor="identifier">Username or email</label>
          <input id="identifier" name="identifier" required autoComplete="username" />
        </div>
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p>
        <a href="/auth/login">Back to log in</a>
      </p>
    </main>
  );
}
