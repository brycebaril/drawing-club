/**
 * model_payout_reports had no constraint stopping two reports from being
 * generated for the same model/week — same class of gap as the missing
 * waitlist_entries/seat_reservations/passes.claim_code constraints found in
 * earlier phases, same fix: a new migration. generatePayoutReports
 * (src/lib/ops/payouts.ts) treats this as the source of truth for
 * idempotency — it skips a model/week pair that already has a row rather
 * than erroring, so re-running the weekly job (or the on-demand button)
 * twice for the same week is a safe no-op.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addConstraint("model_payout_reports", "model_payout_reports_model_id_week_start_date_unique", {
    unique: ["model_id", "week_start_date"],
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("model_payout_reports", "model_payout_reports_model_id_week_start_date_unique");
};
