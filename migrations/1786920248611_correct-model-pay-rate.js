/**
 * MODEL_FLAT_PAY_RATE was seeded at $60.00 — a placeholder that was simply
 * wrong. The organization's real current rate (confirmed against the
 * legacy weekly payout email this feature replaces) is $115.00, effective
 * December 11, 2023. Data-only correction, not an edit to the original seed
 * migration (migrations/1786824018361_default-system-settings.js) — same
 * "new migration, don't rewrite history" convention this project already
 * follows for schema gaps.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`UPDATE system_settings SET value = '115.00' WHERE key = 'MODEL_FLAT_PAY_RATE'`);
};

exports.down = (pgm) => {
  pgm.sql(`UPDATE system_settings SET value = '60.00' WHERE key = 'MODEL_FLAT_PAY_RATE'`);
};
