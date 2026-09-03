/**
 * SecurityDocument.md §6: opt-in marketing email needs "explicit, revocable
 * consent tracked per user," distinct from transactional email (receipts,
 * booking confirmations), which needs none. Defaults to false for every
 * existing row — never assume consent. No backfill from legacy data here;
 * the org will confirm and backfill any real historical source separately.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("users", {
    marketing_email_opt_in: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("users", "marketing_email_opt_in");
};
