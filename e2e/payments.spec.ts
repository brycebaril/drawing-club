import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { createTestUser, pool } from "./helpers";

// Full purchase-flow coverage (Checkout Session → real card → fulfillment)
// needs a real Stripe test-mode account (STRIPE_SECRET_KEY + a running
// `stripe listen` process forwarding to this server) that isn't available
// in this environment — see CLAUDE.md's payments notes. What's covered here
// instead, entirely offline: the webhook route's signature verification,
// idempotency guard, and charge.refunded handling. Signature verification is
// pure HMAC against whatever STRIPE_WEBHOOK_SECRET is configured — it
// doesn't need to come from a real Stripe account, so these run against the
// placeholder value in .env.

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
const stripe = new Stripe("sk_test_unused_signing_only");

function signedWebhookRequest(payload: object) {
  const body = JSON.stringify(payload);
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  return { body, header };
}

function fakeChargeRefundedEvent(opts: { eventId: string; paymentIntentId: string; amountRefundedCents: number }) {
  return {
    id: opts.eventId,
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_${opts.eventId}`,
        object: "charge",
        payment_intent: opts.paymentIntentId,
        amount_refunded: opts.amountRefundedCents,
      },
    },
  };
}

test("webhook route rejects a request with an invalid signature", async ({ request }) => {
  const response = await request.post("/api/webhooks/stripe", {
    data: JSON.stringify({ id: "evt_fake", type: "charge.refunded" }),
    headers: { "stripe-signature": "t=1,v1=not-a-real-signature" },
  });
  expect(response.status()).toBe(400);
});

test("charge.refunded updates the matching transaction's refunded_amount and charge_status", async ({
  request,
}) => {
  const user = await createTestUser({ username: `e2epayrefund${Date.now()}` });
  const paymentIntentId = `pi_test_${Date.now()}`;
  const transactionResult = await pool.query<{ id: string }>(
    `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, charge_status, item_type)
     VALUES ($1, $2, 20.00, 'Succeeded', 'SinglePass')
     RETURNING id`,
    [user.id, paymentIntentId],
  );
  const transactionId = transactionResult.rows[0].id;

  const event = fakeChargeRefundedEvent({
    eventId: `evt_test_refund_${Date.now()}`,
    paymentIntentId,
    amountRefundedCents: 2000,
  });
  const { body, header } = signedWebhookRequest(event);

  const response = await request.post("/api/webhooks/stripe", {
    data: body,
    headers: { "stripe-signature": header, "content-type": "application/json" },
  });
  expect(response.ok()).toBe(true);

  const updated = await pool.query<{ refunded_amount: string; charge_status: string }>(
    `SELECT refunded_amount, charge_status FROM transactions WHERE id = $1`,
    [transactionId],
  );
  expect(updated.rows[0]).toEqual({ refunded_amount: "20.00", charge_status: "Refunded" });
});

test("redelivering the same event id is a no-op the second time (idempotency)", async ({ request }) => {
  const user = await createTestUser({ username: `e2epayidempotent${Date.now()}` });
  const paymentIntentId = `pi_test_${Date.now()}`;
  await pool.query(
    `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, charge_status, item_type)
     VALUES ($1, $2, 20.00, 'Succeeded', 'SinglePass')`,
    [user.id, paymentIntentId],
  );

  const eventId = `evt_test_dup_${Date.now()}`;
  const firstEvent = fakeChargeRefundedEvent({ eventId, paymentIntentId, amountRefundedCents: 500 });
  const first = signedWebhookRequest(firstEvent);
  const firstResponse = await request.post("/api/webhooks/stripe", {
    data: first.body,
    headers: { "stripe-signature": first.header, "content-type": "application/json" },
  });
  expect(firstResponse.ok()).toBe(true);

  // Stripe's at-least-once redelivery — same event.id, and this time it
  // claims a much larger refund. If idempotency didn't hold, the transaction
  // would end up double- (or over-) refunded.
  const secondEvent = fakeChargeRefundedEvent({ eventId, paymentIntentId, amountRefundedCents: 2000 });
  const second = signedWebhookRequest(secondEvent);
  const secondResponse = await request.post("/api/webhooks/stripe", {
    data: second.body,
    headers: { "stripe-signature": second.header, "content-type": "application/json" },
  });
  expect(secondResponse.ok()).toBe(true);
  expect(await secondResponse.json()).toMatchObject({ duplicate: true });

  const finalRow = await pool.query<{ refunded_amount: string }>(
    `SELECT refunded_amount FROM transactions WHERE gateway_ref_id = $1`,
    [paymentIntentId],
  );
  expect(finalRow.rows[0].refunded_amount).toBe("5.00");

  const eventLogCount = await pool.query<{ count: string }>(
    `SELECT count(*) FROM processed_stripe_events WHERE event_id = $1`,
    [eventId],
  );
  expect(Number(eventLogCount.rows[0].count)).toBe(1);
});
