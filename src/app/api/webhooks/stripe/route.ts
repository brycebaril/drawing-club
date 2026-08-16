import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { stripe } from "@/lib/stripe/client";
import { writeAuditLog, type AuditLogEntry } from "@/lib/audit/log";
import { isPurchasableItem } from "@/lib/payments/pricing";
import { getSettingNumber } from "@/lib/settings";

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
  let result: FulfillmentResult;
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

    result = await fulfill(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (result?.auditLog) {
    await writeAuditLog(result.auditLog);
  }

  return NextResponse.json({ received: true });
}

type FulfillmentResult = { auditLog?: AuditLogEntry } | null;
type Fulfiller = (client: PoolClient) => Promise<FulfillmentResult>;

async function prepareFulfillment(event: Stripe.Event): Promise<Fulfiller | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentIntentId = paymentIntentIdOf(session.payment_intent);
      if (!paymentIntentId) return null;
      const { processingFee, netAmount } = await fetchChargeFees(paymentIntentId);
      return (client) =>
        fulfillCheckoutSession(client, session, paymentIntentId, processingFee, netAmount);
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      return (client) => applyRefund(client, charge);
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) return null;
      const charge = await stripe.charges.retrieve(chargeId);
      const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
      if (!paymentIntentId) return null;
      return (client) => applyDispute(client, paymentIntentId);
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

function paymentIntentIdOf(value: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function fetchChargeFees(
  paymentIntentId: string,
): Promise<{ processingFee: number | null; netAmount: number | null }> {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge =
    typeof paymentIntent.latest_charge === "string" || !paymentIntent.latest_charge
      ? null
      : paymentIntent.latest_charge;
  const balanceTransaction =
    charge && typeof charge.balance_transaction !== "string" && charge.balance_transaction
      ? charge.balance_transaction
      : null;
  if (!balanceTransaction) return { processingFee: null, netAmount: null };
  return { processingFee: balanceTransaction.fee / 100, netAmount: balanceTransaction.net / 100 };
}

async function fulfillCheckoutSession(
  client: PoolClient,
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  processingFee: number | null,
  netAmount: number | null,
): Promise<FulfillmentResult> {
  const userId = session.client_reference_id;
  const item = session.metadata?.item;
  if (!userId || !item || !isPurchasableItem(item)) return null;

  const amountPaid = (session.amount_total ?? 0) / 100;
  const itemType: "SinglePass" | "PassPack" | "MembershipRenewal" =
    item === "MembershipRenewal" ? "MembershipRenewal" : item === "SinglePass" ? "SinglePass" : "PassPack";

  const transactionResult = await client.query<{ id: string }>(
    `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, processing_fee, net_amount, charge_status, item_type)
     VALUES ($1, $2, $3, $4, $5, 'Succeeded', $6)
     RETURNING id`,
    [userId, paymentIntentId, amountPaid, processingFee, netAmount, itemType],
  );
  const transactionId = transactionResult.rows[0].id;

  if (item === "MembershipRenewal") {
    const userRow = await client.query<{ membership_expires_at: Date | null }>(
      `SELECT membership_expires_at FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (userRow.rowCount === 0) return null;

    // Renewing before expiry extends the current membership rather than
    // resetting the clock to today.
    const currentExpiry = userRow.rows[0].membership_expires_at;
    const base = currentExpiry && new Date(currentExpiry) > new Date() ? new Date(currentExpiry) : new Date();
    const validUntil = new Date(base);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    await client.query(
      `INSERT INTO membership_history (user_id, transaction_id, valid_from, valid_until, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, transactionId, base, validUntil, userId],
    );
    await client.query(`UPDATE users SET membership_expires_at = $1 WHERE id = $2`, [validUntil, userId]);

    // Design Doc §6.2's membership-perk bonus passes — transferable, so a
    // member actually has something to gift (the only other source is an
    // admin manual grant). §6.6: bonus passes record effective_price $0.00.
    const bonusPassCount = await getSettingNumber("MEMBERSHIP_BONUS_PASSES");
    for (let i = 0; i < bonusPassCount; i++) {
      await client.query(
        `INSERT INTO passes (owner_id, status, is_transferable, effective_price, transaction_id)
         VALUES ($1, 'Available', true, 0, $2)`,
        [userId, transactionId],
      );
    }

    return {
      auditLog: {
        actorId: userId,
        actionType: "MEMBERSHIP_RENEWED",
        targetUserId: userId,
        metadata: { transactionId, amountPaid, validUntil: validUntil.toISOString(), bonusPassCount },
      },
    };
  }

  const passCount = Number(session.metadata?.passCount ?? "0");
  const effectivePricePerPass = session.metadata?.effectivePricePerPass
    ? Number(session.metadata.effectivePricePerPass)
    : amountPaid;

  for (let i = 0; i < passCount; i++) {
    await client.query(
      `INSERT INTO passes (owner_id, status, is_transferable, effective_price, transaction_id)
       VALUES ($1, 'Available', false, $2, $3)`,
      [userId, effectivePricePerPass, transactionId],
    );
  }

  return {
    auditLog: {
      actorId: userId,
      actionType: "PASS_PURCHASED",
      targetUserId: userId,
      metadata: { transactionId, item, passCount, amountPaid, effectivePricePerPass },
    },
  };
}

async function applyRefund(client: PoolClient, charge: Stripe.Charge): Promise<FulfillmentResult> {
  const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
  if (!paymentIntentId) return null;

  await client.query(
    `UPDATE transactions SET refunded_amount = $1, charge_status = 'Refunded' WHERE gateway_ref_id = $2`,
    [charge.amount_refunded / 100, paymentIntentId],
  );

  // No audit log here: a refund initiated through our own admin UI is
  // already logged at initiation time (src/app/admin/transactions/[id]/actions.ts)
  // with a real actor. One issued directly from the Stripe Dashboard has no
  // actor in our system to attribute it to.
  return null;
}

async function applyDispute(client: PoolClient, paymentIntentId: string): Promise<FulfillmentResult> {
  await client.query(`UPDATE transactions SET charge_status = 'Disputed' WHERE gateway_ref_id = $1`, [
    paymentIntentId,
  ]);
  return null;
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
): Promise<FulfillmentResult> {
  if (paymentIntentIds.length === 0) return null;

  await client.query(
    `UPDATE transactions SET payout_status = $1, payout_batch_id = $2 WHERE gateway_ref_id = ANY($3::text[])`,
    [status, payoutId, paymentIntentIds],
  );
  return null;
}
