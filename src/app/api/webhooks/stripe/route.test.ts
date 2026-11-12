import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { pool } from "@/lib/db/pool";

// Stripe records a charge's fee a couple of seconds after
// checkout.session.completed fires, so the fee lookup at fulfillment usually
// finds nothing. charge.updated is the event that says the fee now exists.
const retrieveBalanceTransaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe/client", async () => {
  const { default: RealStripe } = await import("stripe");
  const stripe = new RealStripe("sk_test_unused");
  return { stripe: Object.assign(stripe, { balanceTransactions: { retrieve: retrieveBalanceTransaction } }) };
});

const { POST } = await import("./route");

const WEBHOOK_SECRET = "whsec_vitest";
const signer = new Stripe("sk_test_unused");
const unique = `vitestfees${Date.now()}`;
const eventIds: string[] = [];
let userId: string;

function chargeUpdated(paymentIntentId: string, balanceTransactionId: string): Request {
  const id = `evt_${unique}_${eventIds.length}`;
  eventIds.push(id);
  const body = JSON.stringify({
    id,
    type: "charge.updated",
    data: {
      object: { id: `ch_${id}`, object: "charge", payment_intent: paymentIntentId, balance_transaction: balanceTransactionId },
      previous_attributes: { balance_transaction: null },
    },
  });
  const header = signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": header } });
}

async function insertTransaction(paymentIntentId: string, fee: number | null, net: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, processing_fee, net_amount, charge_status, item_type)
     VALUES ($1, $2, 75.00, $3, $4, 'Succeeded', 'PassPack')`,
    [userId, paymentIntentId, fee, net],
  );
}

async function feesOf(paymentIntentId: string) {
  const result = await pool.query<{ processing_fee: string | null; net_amount: string | null }>(
    `SELECT processing_fee, net_amount FROM transactions WHERE gateway_ref_id = $1`,
    [paymentIntentId],
  );
  return result.rows[0];
}

describe("charge.updated", () => {
  beforeEach(async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    retrieveBalanceTransaction.mockReset();
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
    await pool.query(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it("fills in the fee and net that weren't known when checkout completed", async () => {
    const paymentIntentId = `pi_${unique}_late`;
    await insertTransaction(paymentIntentId, null, null);
    retrieveBalanceTransaction.mockResolvedValue({ id: "txn_late", fee: 308, net: 7192 });

    const response = await POST(chargeUpdated(paymentIntentId, "txn_late"));

    expect(response.status).toBe(200);
    expect(retrieveBalanceTransaction).toHaveBeenCalledWith("txn_late");
    expect(await feesOf(paymentIntentId)).toEqual({ processing_fee: "3.08", net_amount: "71.92" });
  });

  it("leaves a fee that's already recorded alone, without asking Stripe", async () => {
    const paymentIntentId = `pi_${unique}_known`;
    await insertTransaction(paymentIntentId, 1.0, 74.0);

    const response = await POST(chargeUpdated(paymentIntentId, "txn_known"));

    expect(response.status).toBe(200);
    expect(retrieveBalanceTransaction).not.toHaveBeenCalled();
    expect(await feesOf(paymentIntentId)).toEqual({ processing_fee: "1.00", net_amount: "74.00" });
  });
});
