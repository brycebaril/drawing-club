/**
 * Legacy customer-service activity trail, migrated from `registration_logs`
 * (docs/LegacyDataAnalysis.md's Appendix has the full `what` event
 * vocabulary). Deliberately its own table, same reasoning as
 * legacy_attendance_history: a historical reference for admins/volunteers
 * to look up a member's pre-cutover activity, not something this app's own
 * mutations ever write to (that's system_audit_logs). Login/logout events
 * (what 0/1, ~60% of the source rows) are excluded at migration time — not
 * useful for a support conversation.
 *
 * actor_user_id/target_user_id/session_id/transaction_id are real FKs,
 * resolved via the same in-memory legacy-id maps the rest of the migration
 * already builds in one orchestrator run (legacyAttendeeIdToNewId,
 * legacySessionIdToNew, legacyInvoiceIdToTransactionId) — sessions/orders
 * never got their own persisted legacy_id column, so this table can only
 * be populated correctly within that same run, not backfilled later
 * against an already-migrated database.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("legacy_registration_logs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    legacy_id: { type: "integer", notNull: true },
    occurred_at: { type: "timestamptz", notNull: true },
    event_code: { type: "integer", notNull: true },
    event_label: { type: "text", notNull: true },
    actor_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    target_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    session_id: { type: "uuid", references: "sessions", onDelete: "SET NULL" },
    transaction_id: { type: "uuid", references: "transactions", onDelete: "SET NULL" },
    legacy_pass_id: { type: "integer" },
    how_many: { type: "integer", notNull: true, default: 0 },
    comment: { type: "text" },
  });
  pgm.createIndex("legacy_registration_logs", ["actor_user_id", "occurred_at"]);
  pgm.createIndex("legacy_registration_logs", "target_user_id");
};

exports.down = (pgm) => {
  pgm.dropTable("legacy_registration_logs");
};
