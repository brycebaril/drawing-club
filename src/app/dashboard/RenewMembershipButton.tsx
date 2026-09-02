"use client";

import { useActionState } from "react";
import { createCheckoutSessionAction, type CreateCheckoutSessionState } from "@/app/app/wallet/actions";

const initialState: CreateCheckoutSessionState = {};

/**
 * Dashboard-scoped, membership-only — deliberately not the full
 * PurchaseButtons (single/5-pack/10-pack ticket buttons belong on
 * /app/wallet, where a member is actually choosing what to buy; the
 * dashboard's renewal prompt has one specific action).
 */
export function RenewMembershipButton({ label, disabled }: { label: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(createCheckoutSessionAction, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <input type="hidden" name="item" value="MembershipRenewal" />
      <button type="submit" disabled={pending || disabled}>
        {pending ? "Starting checkout…" : label}
      </button>
    </form>
  );
}
