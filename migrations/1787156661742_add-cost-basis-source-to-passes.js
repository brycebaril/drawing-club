/**
 * Distinguishes a pass's effective_price as either a deliberately, exactly
 * known value (a real Stripe charge, an admin-typed manual-grant/batch
 * price, or a migrated free grant confirmed by the legacy ledger) versus a
 * migration-time approximation (a weighted-average estimate standing in for
 * an unrecoverable exact historical purchase price). Requested directly:
 * once this app is live and every new pass is backed by a real transaction,
 * admins should be able to tell which passes still carry an estimated
 * historical cost basis rather than an absolute one.
 *
 * Defaults to 'Exact' — every existing pass-creation call site in the live
 * app (Stripe fulfillment, manual grants, batch generation) already has a
 * deliberately-set real price and needs no code change. Only the legacy
 * migration's ticket-balance conversion explicitly writes 'Estimated'.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType("pass_cost_basis_source", ["Exact", "Estimated"]);
  pgm.addColumn("passes", {
    cost_basis_source: { type: "pass_cost_basis_source", notNull: true, default: "Exact" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("passes", "cost_basis_source");
  pgm.dropType("pass_cost_basis_source");
};
