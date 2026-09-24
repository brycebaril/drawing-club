"use client";

import { useActionState } from "react";
import { changePasswordAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="change-password-current">Current password</label>
        <input id="change-password-current" name="currentPassword" type="password" required autoComplete="current-password" />
      </div>
      <div>
        <label htmlFor="change-password-new">New password</label>
        <input id="change-password-new" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <div>
        <label htmlFor="change-password-confirm">Confirm new password</label>
        <input id="change-password-confirm" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">Password changed.</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
