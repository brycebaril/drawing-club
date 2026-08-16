/**
 * ArchitectureDocument.md §7 lists payout.paid AND payout.failed as the
 * "at minimum" webhook events to handle for payout reconciliation, but the
 * original payout_status enum only had Pending/Paid_Out — no slot for a
 * failed payout, which the Treasurer needs to see (Design Doc §7.3).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addTypeValue("payout_status", "Failed");
};

exports.down = (_pgm) => {
  // Postgres has no DROP VALUE for enums short of recreating the type, which
  // risks failing outright if any row already holds 'Failed' — left as a
  // no-op, same as this project's other irreversible-in-practice migrations.
};
