import Stripe from "stripe";

function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(secretKey);
}

// Unlike src/lib/db/pool.ts's Pool, this client holds no persistent
// connections, so a fresh instance per dev-mode module reload is harmless —
// no globalThis reuse guard needed.
export const stripe = createStripeClient();
