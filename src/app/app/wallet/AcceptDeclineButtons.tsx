"use client";

import { useActionState } from "react";
import { acceptTransferAction, declineTransferAction, type TransferActionState } from "./actions";

const initialState: TransferActionState = {};

export function AcceptDeclineButtons({ passId }: { passId: string }) {
  const [acceptState, acceptAction, acceptPending] = useActionState(acceptTransferAction, initialState);
  const [declineState, declineAction, declinePending] = useActionState(declineTransferAction, initialState);

  return (
    <div>
      <form action={acceptAction} style={{ display: "inline" }}>
        <input type="hidden" name="passId" value={passId} />
        <button type="submit" disabled={acceptPending || declinePending}>
          {acceptPending ? "Accepting…" : "Accept"}
        </button>
      </form>
      <form action={declineAction} style={{ display: "inline" }}>
        <input type="hidden" name="passId" value={passId} />
        <button type="submit" disabled={acceptPending || declinePending}>
          {declinePending ? "Declining…" : "Decline"}
        </button>
      </form>
      {acceptState.error && <p role="alert">{acceptState.error}</p>}
      {declineState.error && <p role="alert">{declineState.error}</p>}
    </div>
  );
}
