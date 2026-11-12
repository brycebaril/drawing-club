import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { stripe } from "@/lib/stripe/client";
import {
  fetchChargeFees,
  fulfillPurchase,
  paidPurchaseOf,
  paymentIntentIdOf,
  isOurCheckout,
} from "@/lib/payments/fulfillCheckout";

/**
 * Single entry point for all Stripe events (ArchitectureDocument.md §7).
 * Excluded from src/proxy.ts's matcher like every other /api/* route — the
 * signature check below *is* this route's auth, not a session/role check.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  // Signature verification needs the exact raw bytes Stripe signed —
  // request.json() would re-serialize and break it.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Any Stripe API calls an event needs (fee lookups, payout batch
  // resolution) happen here, before the idempotency marker is committed —
  // if one of these throws, Stripe retries the whole delivery later rather
  // than us wrongly recording the event as already-handled.
  const fulfill = await prepareFulfillment(event);
  if (!fulfill) {
    return NextResponse.json({ received: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO processed_stripe_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [event.id, event.type],
    );
    if (inserted.rowCount === 0) {
      // Stripe's at-least-once redelivery — already handled this one.
      await client.query("ROLLBACK");
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Any audit-log entry a fulfiller writes goes through this same
    // `client`, inside this same transaction — so a failure partway through
    // (including the audit-log write itself) rolls back the idempotency
    // marker along with everything else, leaving the event genuinely
    // unprocessed for Stripe's next retry, rather than committing the
    // fulfillment but silently losing the audit trail for it.
    await fulfill(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return NextResponse.json({ received: true });
}

type Fulfiller = (client: PoolClient) => Promise<void>;

async function prepareFulfillment(event: Stripe.Event): Promise<Fulfiller | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const purchase = paidPurchaseOf(event.data.object as Stripe.Checkout.Session);
      if (!purchase) return null;
      const fees = await fetchChargeFees(purchase.paymentIntentId);
      return (client) => fulfillPurchase(client, purchase, fees);
    }
    case "charge.updated": {
      // Stripe records a charge's fee ~2s after checkout.session.completed,
      // so that event's fetchChargeFees usually finds nothing; this event is
      // Stripe saying the fee now exists.
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
      const balanceTransactionId =
        typeof charge.balance_transaction === "string" ? charge.balance_transaction : charge.balance_transaction?.id;
      if (!paymentIntentId || !balanceTransactionId) return null;
      if (!(await transactionRecorded(paymentIntentId))) return null;
      // Skips the Stripe call when the fee is already recorded.
      const pending = await pool.query(
        `SELECT 1 FROM transactions WHERE gateway_ref_id = $1 AND processing_fee IS NULL`,
        [paymentIntentId],
      );
      if (pending.rowCount === 0) return null;
      const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);
      return (client) =>
        client.query(
          `UPDATE transactions SET processing_fee = $2, net_amount = $3
           WHERE gateway_ref_id = $1 AND processing_fee IS NULL`,
          [paymentIntentId, balanceTransaction.fee / 100, balanceTransaction.net / 100],
        ).then(() => undefined);
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
      if (!paymentIntentId || !(await transactionRecorded(paymentIntentId))) return null;
      // amount_refunded is the charge's running total, so an older delivery
      // arriving late must not lower it. No audit log: our admin refund action
      // already logged the request with its actor; a Dashboard refund has none.
      return (client) =>
        client.query(
          `UPDATE transactions SET refunded_amount = GREATEST(refunded_amount, $1), charge_status = 'Refunded'
           WHERE gateway_ref_id = $2`,
          [charge.amount_refunded / 100, paymentIntentId],
        ).then(() => undefined);
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) return null;
      const charge = await stripe.charges.retrieve(chargeId);
      const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
      if (!paymentIntentId || !(await transactionRecorded(paymentIntentId))) return null;
      return (client) =>
        client.query(`UPDATE transactions SET charge_status = 'Disputed' WHERE gateway_ref_id = $1`, [
          paymentIntentId,
        ]).then(() => undefined);
    }
    case "payout.paid":
    case "payout.failed": {
      const payout = event.data.object as Stripe.Payout;
      const status = event.type === "payout.paid" ? "Paid_Out" : "Failed";
      const paymentIntentIds = await fetchPaymentIntentIdsForPayout(payout.id);
      return (client) => applyPayout(client, payout.id, status, paymentIntentIds);
    }
    default:
      return null;
  }
}

/**
 * Stripe doesn't order deliveries, so a charge event can beat its own
 * checkout's fulfillment (or land while that is still retrying). For a charge
 * from our Checkout, throwing makes Stripe redeliver this event once the
 * transaction exists; any other charge on the account isn't ours to record.
 */
async function transactionRecorded(paymentIntentId: string): Promise<boolean> {
  const found = await pool.query(`SELECT 1 FROM transactions WHERE gateway_ref_id = $1`, [paymentIntentId]);
  if (found.rowCount) return true;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  if (sessions.data.some(isOurCheckout)) {
    throw new Error(`No transaction for ${paymentIntentId} yet; Stripe will redeliver this event`);
  }
  return false;
}


async function fetchPaymentIntentIdsForPayout(payoutId: string): Promise<string[]> {
  // Capped at 100 — the payout batches this org deals with are far below
  // that; true pagination can be added if that ever stops being true.
  const balanceTransactions = await stripe.balanceTransactions.list({
    payout: payoutId,
    limit: 100,
    expand: ["data.source"],
  });

  const paymentIntentIds: string[] = [];
  for (const balanceTransaction of balanceTransactions.data) {
    if (balanceTransaction.type !== "charge") continue;
    const source = balanceTransaction.source;
    if (!source || typeof source === "string") continue;
    const charge = source as Stripe.Charge;
    const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
    if (paymentIntentId) paymentIntentIds.push(paymentIntentId);
  }
  return paymentIntentIds;
}

async function applyPayout(
  client: PoolClient,
  payoutId: string,
  status: "Paid_Out" | "Failed",
  paymentIntentIds: string[],
): Promise<void> {
  if (paymentIntentIds.length === 0) return;

  await client.query(
    `UPDATE transactions SET payout_status = $1, payout_batch_id = $2 WHERE gateway_ref_id = ANY($3::text[])`,
    [status, payoutId, paymentIntentIds],
  );
}
