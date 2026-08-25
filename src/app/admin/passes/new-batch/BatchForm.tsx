"use client";

import { useActionState } from "react";
import { createBatchAction, type CreateBatchState } from "../actions";

export function BatchForm() {
  const [state, formAction, pending] = useActionState<CreateBatchState, FormData>(createBatchAction, {});

  if (state.success) {
    return (
      <p role="status">
        Batch created for {state.organizationName} — all tickets are already in {state.ownerUsername}
        &apos;s wallet, ready to share.
      </p>
    );
  }

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="organizationName">Organization name</label>
      <input id="organizationName" name="organizationName" required />

      <label htmlFor="ownerUsername">Owner username</label>
      <input id="ownerUsername" name="ownerUsername" required />

      <label htmlFor="quantity">Quantity (1–100)</label>
      <input id="quantity" name="quantity" type="text" required />

      <label htmlFor="effectivePrice">Effective price per ticket</label>
      <input id="effectivePrice" name="effectivePrice" type="text" required />

      <button type="submit" disabled={pending}>
        Generate batch
      </button>
    </form>
  );
}
