/**
 * Late cancellation policy change: a booking within CANCELLATION_CUTOFF_HOURS
 * of its session was previously locked entirely (no cancel action at all).
 * Now cancellation is always possible; canceling within the cutoff frees the
 * seat (for booking/waitlist) but doesn't refund the pass. 'Forfeited' is
 * distinct from 'Revoked': Revoked means the org reclaimed value (e.g. after
 * a refund — see CLAUDE.md's Pass sharing notes); Forfeited means the
 * opposite — money was collected and deliberately NOT given back. Keeping
 * its own status (rather than reusing Revoked) preserves that distinction
 * for yield/ROI accounting and matches the enum-addition convention already
 * used for payout_status's 'Failed' value (pgm.addTypeValue; down is a
 * no-op — Postgres has no DROP VALUE for enums short of recreating the type).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addTypeValue("pass_status", "Forfeited");
};

exports.down = (_pgm) => {
  // Postgres has no DROP VALUE for enums short of recreating the type, which
  // risks failing outright if any row already holds 'Forfeited' — left as a
  // no-op, same as this project's other irreversible-in-practice migrations.
};
