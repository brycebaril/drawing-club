/**
 * Prerequisite for the legacy data migration (docs/MigrationPlan.md §3/§5).
 * Legacy's board_status entitlement (owned_passes/owned_entitlements) had no
 * destination in this app's role system — resolved directly with the org:
 * a Board Member is a volunteer type that also carries base_role='Admin'.
 * The base_role='Admin' half is a per-user data decision made at migration
 * time, not something this schema change can enforce on its own.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addTypeValue("volunteer_role_name", "Board");
};

exports.down = (_pgm) => {
  // Postgres has no DROP VALUE for enums short of recreating the type, which
  // risks failing outright if any row already holds 'Board' — left as a
  // no-op, same as this project's other irreversible-in-practice migrations
  // (see 1786901608328_payout-status-failed.js).
};
