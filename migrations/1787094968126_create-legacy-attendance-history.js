/**
 * Prerequisite for the legacy data migration (docs/MigrationPlan.md §3.4/§5).
 * Populated once, at cutover, from legacy's seat_registrations (25,725
 * past-dated rows) — deliberately its own table rather than synthesized
 * into passes/transactions, so 25K rows of necessarily-estimated historical
 * pricing never mix into the tables /ops/financials and /admin/dashboard
 * treat as real revenue ground truth. funded_by is a plain marker rather
 * than a real effective_price, since no per-row historical price is
 * reconstructable this far back (see MigrationPlan.md's transactions/passes
 * mapping for why the numTickets balance conversion only covers currently-
 * outstanding balances, not full historical attendance).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("legacy_attendance_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    legacy_registration_id: { type: "varchar(255)" },
    session_id: { type: "uuid", references: "sessions", onDelete: "SET NULL" },
    user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    registered_by_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    checked_in: { type: "boolean", notNull: true, default: false },
    funded_by: { type: "text", notNull: true },
  });
  pgm.createIndex("legacy_attendance_history", "session_id");
  pgm.createIndex("legacy_attendance_history", "user_id");
};

exports.down = (pgm) => {
  pgm.dropTable("legacy_attendance_history");
};
