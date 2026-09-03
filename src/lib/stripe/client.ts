import Stripe from "stripe";

function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  // Default is 0 — a transient network blip (timeout, connection reset) or a
  // Stripe-side 5xx/lock-conflict would otherwise fail every call on the
  // first attempt with no retry at all. Safe to enable now that the two
  // mutating call sites (checkout.sessions.create, refunds.create) both pass
  // an explicit idempotencyKey (src/app/app/wallet/actions.ts,
  // src/app/admin/transactions/[id]/actions.ts) — the SDK reuses that same
  // key across its own internal retries, so a retried POST can't create a
  // second Checkout Session or a second refund.
  return new Stripe(secretKey, { maxNetworkRetries: 2 });
}

// Unlike src/lib/db/pool.ts's Pool, this client holds no persistent
// connections, so a fresh instance per dev-mode module reload is harmless —
// no globalThis reuse guard needed.
export const stripe = createStripeClient();
