"use client";

import Link from "next/link";
import { useActionState } from "react";
import { disableMfaAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function MfaSettingsSection({ mfaEnabled, mfaRequired }: { mfaEnabled: boolean; mfaRequired: boolean }) {
  const [state, formAction, pending] = useActionState(disableMfaAction, initialState);

  if (!mfaEnabled) {
    return (
      <div>
        <p>Two-factor authentication is off.</p>
        <p>
          <Link href="/auth/mfa-setup">Enable two-factor authentication</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p>Two-factor authentication is on.</p>
      {/* Hidden entirely (not just disabled) for a mandatory role — matches
          disableMfa()'s own server-side refusal, this is the UI half. */}
      {!mfaRequired && (
        <form action={formAction}>
          {state.error && <p role="alert">{state.error}</p>}
          <button type="submit" disabled={pending}>
            {pending ? "Disabling…" : "Disable two-factor authentication"}
          </button>
        </form>
      )}
    </div>
  );
}
