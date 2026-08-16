"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { pool } from "@/lib/db/pool";
import { stripe } from "@/lib/stripe/client";

export interface RefundTransactionState {
  error?: string;
}

/**
 * Calls Stripe's refund API — does NOT write refunded_amount/charge_status
 * itself. That happens when the resulting charge.refunded webhook lands
 * (src/app/api/webhooks/stripe/route.ts), which stays the single writer of
 * a transaction's charge state either way (dashboard-issued refunds land
 * the same way). This action only records that an admin requested it.
 *
 * Per Design Doc §7.1, a refund does not auto-revoke any still-unspent
 * passes from the same purchase — that stays a separate, explicit choice an
 * admin makes on the buyer's own /admin/users/[id] page.
 */
export async function refundTransactionAction(
  _prevState: RefundTransactionState,
  formData: FormData,
): Promise<RefundTransactionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const transactionId = String(formData.get("transactionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "A reason is required for the audit trail." };
  }

  const amountInput = String(formData.get("amount") ?? "").trim();
  let amount: number | null = null;
  if (amountInput) {
    amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Amount must be a positive number, or blank for a full refund." };
    }
  }

  const transactionRow = await pool.query<{
    user_id: string;
    gateway_ref_id: string;
    amount_paid: string;
    refunded_amount: string | null;
    charge_status: string;
  }>(
    `SELECT user_id, gateway_ref_id, amount_paid, refunded_amount, charge_status
     FROM transactions WHERE id = $1`,
    [transactionId],
  );
  if (transactionRow.rowCount === 0) {
    return { error: "Transaction not found." };
  }
  const transaction = transactionRow.rows[0];

  if (transaction.charge_status !== "Succeeded" && transaction.charge_status !== "Refunded") {
    return { error: `Can't refund a charge with status "${transaction.charge_status}".` };
  }

  const remaining = Number(transaction.amount_paid) - Number(transaction.refunded_amount ?? 0);
  if (remaining <= 0) {
    return { error: "This transaction has already been fully refunded." };
  }
  if (amount !== null && amount > remaining) {
    return { error: `Amount can't exceed the $${remaining.toFixed(2)} still refundable.` };
  }

  try {
    await stripe.refunds.create({
      payment_intent: transaction.gateway_ref_id,
      amount: amount !== null ? Math.round(amount * 100) : undefined,
    });
  } catch {
    return { error: "Stripe rejected the refund. Try again or check the Stripe Dashboard." };
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PAYMENT_REFUND_REQUESTED",
    targetUserId: transaction.user_id,
    metadata: { transactionId, amount: amount ?? remaining, reason },
  });

  revalidatePath(`/admin/transactions/${transactionId}`);
  revalidatePath("/admin/transactions");
  redirect(`/admin/transactions/${transactionId}`);
}
