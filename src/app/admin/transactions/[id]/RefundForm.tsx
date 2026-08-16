"use client";

import { useActionState } from "react";
import { refundTransactionAction, type RefundTransactionState } from "./actions";

const initialState: RefundTransactionState = {};

export function RefundForm({ transactionId, remaining }: { transactionId: string; remaining: number }) {
  const [state, formAction, pending] = useActionState(refundTransactionAction, initialState);

  return (
    <form action={formAction}>
      <h2>Issue a refund</h2>
      <input type="hidden" name="transactionId" value={transactionId} />
      {state.error && <p role="alert">{state.error}</p>}
      <div>
        <label htmlFor="refund-amount">Amount (blank for full ${remaining.toFixed(2)} refund)</label>
        <input id="refund-amount" name="amount" type="number" min="0.01" step="0.01" max={remaining} />
      </div>
      <div>
        <label htmlFor="refund-reason">Reason (required)</label>
        <input id="refund-reason" name="reason" required />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Refunding…" : "Issue refund"}
      </button>
    </form>
  );
}
