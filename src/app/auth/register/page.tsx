"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { registerAction, type RegisterState } from "./actions";

const initialState: RegisterState = {};

function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);
  // Prefilled when arriving from a "come register" ticket-share invite
  // email (src/app/app/wallet/actions.ts's inviteMemberByEmailAction) —
  // avoids the invitee retyping (and possibly mistyping) their email.
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get("email") ?? "";

  return (
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
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={invitedEmail}
        />
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
      <div>
        <label>
          <input type="checkbox" name="marketingOptIn" />
          {" "}Send me occasional email about upcoming events and news
        </label>
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <main>
      <h1>Create an account</h1>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
      <p>
        Already have an account? <a href="/auth/login">Log in</a>
      </p>
    </main>
  );
}
