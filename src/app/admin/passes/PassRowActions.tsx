"use client";

import { useActionState, useState } from "react";
import { reissueClaimCodeAction, revokePassAction, type ReissueState, type RevokeState } from "./actions";

export function PassRowActions({ passId }: { passId: string }) {
  const [reissueState, reissueAction, reissuePending] = useActionState<ReissueState, FormData>(
    reissueClaimCodeAction,
    {},
  );
  const [revokeState, revokeAction, revokePending] = useActionState<RevokeState, FormData>(
    revokePassAction,
    {},
  );
  const [showRevoke, setShowRevoke] = useState(false);

  return (
    <div>
      <form action={reissueAction}>
        <input type="hidden" name="passId" value={passId} />
        <button type="submit" disabled={reissuePending}>
          Reissue code
        </button>
      </form>
      {reissueState.newCode && (
        <p role="alert">
          New code (shown once): <code>{reissueState.newCode}</code>
        </p>
      )}
      {reissueState.error && <p role="alert">{reissueState.error}</p>}

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
