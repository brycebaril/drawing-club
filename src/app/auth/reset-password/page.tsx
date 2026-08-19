"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = {};

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  if (state.success) {
    return (
      <main>
        <h1>Password reset</h1>
        <p>Your password has been changed. You can now log in with your new password.</p>
        <p>
          <a href="/auth/login">Log in</a>
        </p>
      </main>
    );
  }

  if (!token) {
    return (
      <main>
        <h1>Reset your password</h1>
        <p role="alert">This reset link is missing its token. Request a new one.</p>
        <p>
          <a href="/auth/forgot-password">Request a reset link</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Reset your password</h1>
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor="password">New password</label>
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
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Resetting…" : "Reset password"}
        </button>
      </form>
    </main>
  );
}
