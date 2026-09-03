/**
 * Backs the weekly volunteer free-pass distribution feature.
 *
 * passes.is_volunteer_grant distinguishes a labor-comp grant from every
 * other kind of $0/admin-granted pass — without it, the wallet-cap check
 * below can't tell "N volunteer passes piling up unclaimed" from "N passes
 * this person separately bought or was gifted."
 *
 * volunteer_pass_grants is the idempotency guard, same reasoning as
 * model_payout_reports' own UNIQUE(model_id, week_start_date): without it,
 * running the grant script/button twice in the same week would double-grant
 * everyone.
 *
 * VOLUNTEER_PASS_WALLET_CAP is the configurable cap ("as long as they
 * currently hold fewer than N"). VOLUNTEER_WEEKLY_PASS_ALLOWANCE (the
 * per-week count) already exists, seeded from the very first migration —
 * this feature is its first real reader.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("passes", {
    is_volunteer_grant: { type: "boolean", notNull: true, default: false },
  });

  pgm.createTable("volunteer_pass_grants", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    week_start_date: { type: "date", notNull: true },
    granted_count: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("volunteer_pass_grants", "volunteer_pass_grants_user_week_unique", {
    unique: ["user_id", "week_start_date"],
  });

  pgm.sql(`
    INSERT INTO system_settings (key, value, data_type, description)
    VALUES (
      'VOLUNTEER_PASS_WALLET_CAP',
      '50',
      'Integer',
      'Weekly volunteer free-pass grants stop once a volunteer already holds at least this many unspent volunteer-granted tickets.'
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'VOLUNTEER_PASS_WALLET_CAP'`);
  pgm.dropTable("volunteer_pass_grants");
  pgm.dropColumn("passes", "is_volunteer_grant");
};
