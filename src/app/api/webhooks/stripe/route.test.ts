import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { pool } from "@/lib/db/pool";

// The Stripe calls fulfillment makes are mocked; signature checking stays
// real, so every event below goes through POST the way Stripe delivers it.
const stripeApi = vi.hoisted(() => ({
  balanceTransactions: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  checkout: { sessions: { list: vi.fn(), retrieve: vi.fn() } },
}));
vi.mock("@/lib/stripe/client", async () => {
  const { default: RealStripe } = await import("stripe");
  return { stripe: Object.assign(new RealStripe("sk_test_unused"), stripeApi) };
});

const { POST } = await import("./route");

const WEBHOOK_SECRET = "whsec_vitest";
const signer = new Stripe("sk_test_unused");
const unique = `vitestwh${Date.now()}`;
const eventIds: string[] = [];
let userId: string;

function deliver(type: string, object: object, previousAttributes?: object): Promise<Response> {
  const id = `evt_${unique}_${eventIds.length}`;
  eventIds.push(id);
  const body = JSON.stringify({ id, type, data: { object, previous_attributes: previousAttributes } });
  const header = signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  return POST(
    new Request("http://localhost/api/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": header } }),
  );
}

function checkoutSession(paymentIntentId: string, overrides: object = {}) {
  return {
    id: `cs_${paymentIntentId}`,
    object: "checkout.session",
    payment_intent: paymentIntentId,
    payment_status: "paid",
    amount_total: 7500,
    client_reference_id: userId,
    metadata: { userId, item: "Pack5", passCount: "5", effectivePricePerPass: "15" },
    ...overrides,
  };
}

function charge(paymentIntentId: string, fields: object = {}) {
  return { id: `ch_${paymentIntentId}`, object: "charge", payment_intent: paymentIntentId, ...fields };
}

async function insertTransaction(paymentIntentId: string, fee: number | null, net: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, processing_fee, net_amount, charge_status, item_type)
     VALUES ($1, $2, 75.00, $3, $4, 'Succeeded', 'PassPack')`,
    [userId, paymentIntentId, fee, net],
  );
}

async function transactionsFor(paymentIntentId: string) {
  const result = await pool.query<{
    processing_fee: string | null;
    net_amount: string | null;
    refunded_amount: string | null;
    passes: string;
  }>(
    `SELECT t.processing_fee, t.net_amount, t.refunded_amount,
            (SELECT count(*) FROM passes p WHERE p.transaction_id = t.id) AS passes
     FROM transactions t WHERE t.gateway_ref_id = $1`,
    [paymentIntentId],
  );
  return result.rows;
}

beforeEach(async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.resetAllMocks();
  stripeApi.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
  stripeApi.checkout.sessions.list.mockResolvedValue({ data: [] });
  if (!userId) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, email, base_role, status)
       VALUES ($1, 'x', $2, 'AccountHolder', 'Active') RETURNING id`,
      [unique, `${unique}@example.test`],
    );
    userId = result.rows[0].id;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.query(`DELETE FROM processed_stripe_events WHERE event_id = ANY($1)`, [eventIds]);
  await pool.query(`DELETE FROM passes WHERE owner_id = $1`, [userId]);
  await pool.query(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
});

describe("checkout fulfillment", () => {
  it("grants a purchase once when the buyer's return and the webhook both deliver it", async () => {
    const paymentIntentId = `pi_${unique}_return`;
    stripeApi.checkout.sessions.retrieve.mockResolvedValue(checkoutSession(paymentIntentId));
    const { fulfillReturnedCheckout } = await import("@/lib/payments/fulfillCheckout");

    await fulfillReturnedCheckout(`cs_${paymentIntentId}`, userId);
    expect(await transactionsFor(paymentIntentId)).toHaveLength(1);

    const response = await deliver("checkout.session.completed", checkoutSession(paymentIntentId));

    expect(response.status).toBe(200);
    expect(await transactionsFor(paymentIntentId)).toEqual([expect.objectContaining({ passes: "5" })]);
  });

  it("won't fulfill someone else's checkout from a wallet return", async () => {
    const paymentIntentId = `pi_${unique}_notmine`;
    stripeApi.checkout.sessions.retrieve.mockResolvedValue(checkoutSession(paymentIntentId));
    const { fulfillReturnedCheckout } = await import("@/lib/payments/fulfillCheckout");

    await fulfillReturnedCheckout(`cs_${paymentIntentId}`, "00000000-0000-0000-0000-000000000000");

    expect(await transactionsFor(paymentIntentId)).toEqual([]);
  });

  it("grants nothing for a checkout that hasn't been paid", async () => {
    const paymentIntentId = `pi_${unique}_unpaid`;

    const response = await deliver(
      "checkout.session.completed",
      checkoutSession(paymentIntentId, { payment_status: "unpaid" }),
    );

    expect(response.status).toBe(200);
    expect(await transactionsFor(paymentIntentId)).toEqual([]);
  });
});

describe("charge events that arrive before their checkout is recorded", () => {
  it("fails so Stripe redelivers, when the charge came from our checkout", async () => {
    const paymentIntentId = `pi_${unique}_early`;
    stripeApi.checkout.sessions.list.mockResolvedValue({ data: [checkoutSession(paymentIntentId)] });

    await expect(
      deliver("charge.updated", charge(paymentIntentId, { balance_transaction: "txn_early" }), {
        balance_transaction: null,
      }),
    ).rejects.toThrow();

    const processed = await pool.query(`SELECT 1 FROM processed_stripe_events WHERE event_id = $1`, [eventIds.at(-1)]);
    expect(processed.rowCount).toBe(0);
  });

  it("ignores charges that didn't come from our checkout", async () => {
    const paymentIntentId = `pi_${unique}_foreign`;

    const response = await deliver("charge.refunded", charge(paymentIntentId, { amount_refunded: 500 }));

    expect(response.status).toBe(200);
    expect(await transactionsFor(paymentIntentId)).toEqual([]);
  });
});

describe("charge.updated", () => {
  it("fills in the fee and net that weren't known when checkout completed", async () => {
    const paymentIntentId = `pi_${unique}_late`;
    await insertTransaction(paymentIntentId, null, null);
    stripeApi.balanceTransactions.retrieve.mockResolvedValue({ id: "txn_late", fee: 308, net: 7192 });

    const response = await deliver("charge.updated", charge(paymentIntentId, { balance_transaction: "txn_late" }), {
      balance_transaction: null,
    });

    expect(response.status).toBe(200);
    expect(stripeApi.balanceTransactions.retrieve).toHaveBeenCalledWith("txn_late");
    expect(await transactionsFor(paymentIntentId)).toEqual([
      expect.objectContaining({ processing_fee: "3.08", net_amount: "71.92" }),
    ]);
  });

  it("leaves a fee that's already recorded alone, without asking Stripe", async () => {
    const paymentIntentId = `pi_${unique}_known`;
    await insertTransaction(paymentIntentId, 1.0, 74.0);

    const response = await deliver("charge.updated", charge(paymentIntentId, { balance_transaction: "txn_known" }), {
      balance_transaction: null,
    });

    expect(response.status).toBe(200);
    expect(stripeApi.balanceTransactions.retrieve).not.toHaveBeenCalled();
    expect(await transactionsFor(paymentIntentId)).toEqual([
      expect.objectContaining({ processing_fee: "1.00", net_amount: "74.00" }),
    ]);
  });
});

describe("charge.refunded", () => {
  it("keeps the larger refunded amount when Stripe delivers refunds out of order", async () => {
    const paymentIntentId = `pi_${unique}_refunds`;
    await insertTransaction(paymentIntentId, null, null);

    await deliver("charge.refunded", charge(paymentIntentId, { amount_refunded: 1700 }));
    await deliver("charge.refunded", charge(paymentIntentId, { amount_refunded: 500 }));

    expect(await transactionsFor(paymentIntentId)).toEqual([expect.objectContaining({ refunded_amount: "17.00" })]);
  });
});
