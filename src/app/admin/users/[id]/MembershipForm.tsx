"use client";

import { useActionState } from "react";
import { adjustMembershipAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function MembershipForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(adjustMembershipAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="expiresAt">New expiration date</label>
      <input id="expiresAt" name="expiresAt" type="date" required />
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set membership expiration"}
      </button>
      <p>
        <em>A future date grants/extends membership; a past or today&apos;s date ends it immediately.</em>
      </p>
    </form>
  );
}
