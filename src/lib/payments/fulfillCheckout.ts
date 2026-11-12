import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { stripe } from "@/lib/stripe/client";
import { writeAuditLog } from "@/lib/audit/log";
import { isPurchasableItem, type PurchasableItem } from "@/lib/payments/pricing";
import { getSettingNumber } from "@/lib/settings";

/**
 * Turns a paid Checkout Session into a transaction plus tickets or a
 * membership extension. Two callers: the Stripe webhook
 * (src/app/api/webhooks/stripe/route.ts) and the buyer's own return to
 * /app/wallet, so a purchase lands even if the webhook is slow or broken.
 * Whichever runs second finds the transaction already there
 * (UNIQUE gateway_ref_id) and does nothing.
 */

export interface CheckoutPurchase {
  session: Stripe.Checkout.Session;
  userId: string;
  item: PurchasableItem;
  paymentIntentId: string;
}

export interface ChargeFees {
  processingFee: number | null;
  netAmount: number | null;
}

export function paymentIntentIdOf(value: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** True for a Checkout Session created by createCheckoutSessionAction. */
export function isOurCheckout(session: Stripe.Checkout.Session): boolean {
  return Boolean(session.client_reference_id) && isPurchasableItem(session.metadata?.item ?? "");
}

/** The purchase a session represents, or null if it isn't ours or isn't paid yet. */
export function paidPurchaseOf(session: Stripe.Checkout.Session): CheckoutPurchase | null {
  const paymentIntentId = paymentIntentIdOf(session.payment_intent);
  if (!isOurCheckout(session) || session.payment_status !== "paid" || !paymentIntentId) return null;
  return {
    session,
    userId: session.client_reference_id!,
    item: session.metadata!.item as PurchasableItem,
    paymentIntentId,
  };
}

/** Usually both null: Stripe records the fee ~2s after checkout completes; charge.updated fills it in. */
export async function fetchChargeFees(paymentIntentId: string): Promise<ChargeFees> {
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

export async function fulfillPurchase(client: PoolClient, purchase: CheckoutPurchase, fees: ChargeFees): Promise<void> {
  const { session, userId, item, paymentIntentId } = purchase;
  const amountPaid = (session.amount_total ?? 0) / 100;
  const itemType: "SinglePass" | "PassPack" | "MembershipRenewal" =
    item === "MembershipRenewal" ? "MembershipRenewal" : item === "SinglePass" ? "SinglePass" : "PassPack";

  const transactionResult = await client.query<{ id: string }>(
    `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, processing_fee, net_amount, charge_status, item_type)
     VALUES ($1, $2, $3, $4, $5, 'Succeeded', $6)
     ON CONFLICT (gateway_ref_id) DO NOTHING
     RETURNING id`,
    [userId, paymentIntentId, amountPaid, fees.processingFee, fees.netAmount, itemType],
  );
  if (transactionResult.rowCount === 0) return; // Already fulfilled by the other caller.
  const transactionId = transactionResult.rows[0].id;

  if (item === "MembershipRenewal") {
    const userRow = await client.query<{ membership_expires_at: Date | null }>(
      `SELECT membership_expires_at FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (userRow.rowCount === 0) return;

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

    await writeAuditLog(
      {
        actorId: userId,
        actionType: "MEMBERSHIP_RENEWED",
        targetUserId: userId,
        metadata: { transactionId, amountPaid, validUntil: validUntil.toISOString(), bonusPassCount },
      },
      client,
    );
    return;
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

  await writeAuditLog(
    {
      actorId: userId,
      actionType: "PASS_PURCHASED",
      targetUserId: userId,
      metadata: { transactionId, item, passCount, amountPaid, effectivePricePerPass },
    },
    client,
  );
}

/**
 * Stripe's own recommendation: fulfill on the success page too, not only in
 * the webhook. Never throws — if this fails the webhook still delivers it.
 */
export async function fulfillReturnedCheckout(checkoutSessionId: string, viewerId: string): Promise<void> {
  if (!/^cs_\w+$/.test(checkoutSessionId)) return; // From the URL, so anyone can put anything there.
  try {
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const purchase = paidPurchaseOf(session);
    if (!purchase || purchase.userId !== viewerId) return;
    const fees = await fetchChargeFees(purchase.paymentIntentId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await fulfillPurchase(client, purchase, fees);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`Fulfilling returned checkout ${checkoutSessionId} failed; the webhook will retry it`, error);
  }
}
