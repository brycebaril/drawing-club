"use client";

import { useActionState } from "react";
import { createCheckoutSessionAction, type CreateCheckoutSessionState } from "./actions";

const initialState: CreateCheckoutSessionState = {};

export function PurchaseButtons({ isMember, disabled }: { isMember: boolean; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(createCheckoutSessionAction, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" name="item" value="SinglePass" disabled={pending || disabled}>
        Buy a single ticket
      </button>
      <button type="submit" name="item" value="Pack5" disabled={pending || disabled}>
        Buy a 5-pack
      </button>
      {isMember && (
        <button type="submit" name="item" value="Pack10" disabled={pending || disabled}>
          Buy a 10-pack
        </button>
      )}
      <button type="submit" name="item" value="MembershipRenewal" disabled={pending || disabled}>
        Renew membership
      </button>
    </form>
  );
}
