"use client";

import { useActionState, useState } from "react";
import { revokeUserPassAction, type ActionState } from "./actions";

export function RevokePassButton({ userId, passId }: { userId: string; passId: string }) {
  const [revokeState, revokeAction, revokePending] = useActionState<ActionState, FormData>(
    revokeUserPassAction,
    {},
  );
  const [showRevoke, setShowRevoke] = useState(false);

  return (
    <div>
      {showRevoke ? (
        <form action={revokeAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="passId" value={passId} />
          <label htmlFor={`revoke-reason-${passId}`}>Reason</label>
          <input id={`revoke-reason-${passId}`} name="reason" required />
          <button type="submit" disabled={revokePending}>
            Confirm revoke
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setShowRevoke(true)}>
          Revoke
        </button>
      )}
      {revokeState.error && <p role="alert">{revokeState.error}</p>}
    </div>
  );
}
