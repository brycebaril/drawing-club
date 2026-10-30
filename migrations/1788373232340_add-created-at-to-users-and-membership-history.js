/**
 * Backs the admin dashboard's new "New this week" account-activity report
 * (accountActivity.ts) — distinguishing a new account from a new membership
 * signup from a renewal needs a real creation timestamp on both tables,
 * which neither had until now.
 *
 * Add-then-backfill-then-constrain, same shape as pass-direct-transfers.js
 * (not passes-created-at.js, which backfills every row to one shared `now()`
 * value — the wrong shape here, since that would make every pre-existing
 * user/membership row look like it happened this week).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("users", { created_at: { type: "timestamptz" } });
  pgm.addColumn("membership_history", { created_at: { type: "timestamptz" } });

  // email_verified_at is the best available signal of "account became
  // real" — for a legacy-migrated account this is the migration cutover
  // date (docs/MigrationPlan.md §5), not the true original signup date, but
  // that's fine here since it's in the past, not "this week." The
  // 2020-01-01 fallback covers any row with neither (shouldn't exist in
  // practice, but the column is NOT NULL below so every row needs a value).
  pgm.sql(`UPDATE users SET created_at = COALESCE(email_verified_at, '2020-01-01T00:00:00Z')`);

  // Prefer the linked transaction's created_at (set explicitly by both the
  // Stripe webhook and the legacy transactions migration); admin-granted
  // rows (no transaction_id) fall back to valid_from, which is the real
  // event time for that path specifically (src/app/admin/users/[id]/actions.ts).
  pgm.sql(`
    UPDATE membership_history mh SET created_at = t.created_at
    FROM transactions t WHERE mh.transaction_id = t.id
  `);
  pgm.sql(`UPDATE membership_history SET created_at = valid_from WHERE created_at IS NULL`);

  pgm.alterColumn("users", "created_at", { notNull: true, default: pgm.func("now()") });
  pgm.alterColumn("membership_history", "created_at", { notNull: true, default: pgm.func("now()") });

  pgm.createIndex("users", "created_at");
  pgm.createIndex("membership_history", ["user_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropColumn("membership_history", "created_at");
  pgm.dropColumn("users", "created_at");
};
