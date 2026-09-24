"use client";

import { useActionState } from "react";
import { updateMarketingOptInAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function MarketingOptInForm({ optedIn }: { optedIn: boolean }) {
  const [state, formAction, pending] = useActionState(updateMarketingOptInAction, initialState);

  return (
    <form action={formAction}>
      <label>
        <input type="checkbox" id="marketing-opt-in" name="marketingOptIn" defaultChecked={optedIn} />{" "}
        Send me occasional email about upcoming events and news
      </label>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
