/**
 * One transaction per Stripe payment. The webhook and the buyer's return to
 * /app/wallet can both fulfill the same Checkout (src/lib/payments/fulfillCheckout.ts);
 * this is what makes the second one a no-op via ON CONFLICT (gateway_ref_id).
 * Legacy rows are already unique: `legacy-invoice-<invoice>-<component>`.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addConstraint("transactions", "transactions_gateway_ref_id_unique", { unique: "gateway_ref_id" });
};

exports.down = (pgm) => {
  pgm.dropConstraint("transactions", "transactions_gateway_ref_id_unique");
};
