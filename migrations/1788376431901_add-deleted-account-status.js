/**
 * Backs GDPR-style admin account anonymization (anonymizeAccountAction,
 * admin/users/[id]/actions.ts). Distinct from the existing Banned value on
 * purpose: Banned is a behavioral/moderation decision, Deleted means "this
 * account was anonymized per an erasure request" — different meaning,
 * should read differently on an audit trail and a status badge. Per
 * docs/SecurityDocument.md §6, a real row deletion isn't viable anyway
 * (transactions.user_id and others are ON DELETE RESTRICT) — anonymization
 * in place is the actual mechanism, and this status marks that it happened.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addTypeValue("account_status", "Deleted");
};

exports.down = (_pgm) => {
  // Postgres has no DROP VALUE for enums short of recreating the type, which
  // risks failing outright if any row already holds 'Deleted' — left as a
  // no-op, same as this project's other irreversible-in-practice migrations
  // (e.g. 1786901608328_payout-status-failed.js).
};
