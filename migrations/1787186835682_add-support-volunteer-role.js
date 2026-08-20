/**
 * New volunteer sub-role for a member-facing support-ticket system
 * (src/lib/support/actions.ts, /app/support, /ops/support) — handles
 * account-holder support requests separately from the public /contact form,
 * which stays the surface for pre-account issues like login trouble.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addTypeValue("volunteer_role_name", "SupportAgent");
};

exports.down = (_pgm) => {
  // Postgres has no DROP VALUE for enums short of recreating the type, which
  // risks failing outright if any row already holds 'SupportAgent' — left as
  // a no-op, same as this project's other irreversible-in-practice
  // migrations (see 1787094908334_add-board-volunteer-role.js).
};
