"use client";

import { useActionState } from "react";
import { grantPassAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function GrantPassForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(grantPassAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="grant-quantity">Quantity</label>
      <input
        id="grant-quantity"
        name="quantity"
        type="number"
        min={1}
        max={100}
        defaultValue={1}
        required
      />
      <fieldset>
        <legend>Ticket type</legend>
        <label>
          <input type="radio" name="passType" value="Standard" defaultChecked /> Standard
        </label>
        <label>
          <input type="radio" name="passType" value="Transferable" /> Transferable
        </label>
      </fieldset>
      <label htmlFor="grant-reason">Reason (required)</label>
      <input
        id="grant-reason"
        name="reason"
        placeholder="e.g. Volunteer reward, customer service voucher"
        required
      />
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Granting…" : "Grant tickets"}
      </button>
    </form>
  );
}
