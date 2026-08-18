"use client";

import { useActionState } from "react";
import { registerAction, type RegisterState } from "./actions";

const initialState: RegisterState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);

  return (
    <main>
      <h1>Create an account</h1>
      <form action={formAction}>
        <div>
          <label htmlFor="displayName">Name</label>
          <input id="displayName" name="displayName" required maxLength={255} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" required minLength={3} maxLength={32} autoComplete="username" />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p>
        Already have an account? <a href="/auth/login">Log in</a>
      </p>
    </main>
  );
}
