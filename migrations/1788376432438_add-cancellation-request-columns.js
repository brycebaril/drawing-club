/**
 * The flag a member's self-service cancellation request sets
 * (requestCancellationAction, dashboard/actions.ts) for an admin to see and
 * act on via anonymizeAccountAction. Both nullable, no backfill — NULL
 * (no pending request) is the correct default for every existing row.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("users", {
    cancellation_requested_at: { type: "timestamptz" },
    cancellation_reason: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("users", ["cancellation_requested_at", "cancellation_reason"]);
};
