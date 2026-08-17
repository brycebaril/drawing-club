"use client";

import { useActionState, useState } from "react";
import { revokePassAction, type RevokeState } from "./actions";

export function PassRowActions({ passId }: { passId: string }) {
  const [revokeState, revokeAction, revokePending] = useActionState<RevokeState, FormData>(
    revokePassAction,
    {},
  );
  const [showRevoke, setShowRevoke] = useState(false);

  return (
    <div>
      {showRevoke ? (
        <form action={revokeAction}>
          <input type="hidden" name="passId" value={passId} />
          <label htmlFor={`reason-${passId}`}>Reason</label>
          <input id={`reason-${passId}`} name="reason" required />
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
