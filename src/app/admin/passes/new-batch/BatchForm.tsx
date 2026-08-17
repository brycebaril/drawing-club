"use client";

import { useActionState } from "react";
import { createBatchAction, type CreateBatchState } from "../actions";

export function BatchForm() {
  const [state, formAction, pending] = useActionState<CreateBatchState, FormData>(createBatchAction, {});

  if (state.codes) {
    return (
      <div>
        <p role="alert">
          Batch created for {state.organizationName} — {state.codes.length} claim code(s), shown once. Copy
          these now; they can&apos;t be shown again (a lost code can be reissued later from the passes list).
        </p>
        <ul>
          {state.codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="organizationName">Organization name</label>
      <input id="organizationName" name="organizationName" required />

      <label htmlFor="quantity">Quantity (1–100)</label>
      <input id="quantity" name="quantity" type="text" required />

      <label htmlFor="effectivePrice">Effective price per pass</label>
      <input id="effectivePrice" name="effectivePrice" type="text" required />

      <button type="submit" disabled={pending}>
        Generate batch
      </button>
    </form>
  );
}
