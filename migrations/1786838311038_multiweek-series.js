/**
 * Multi-Week Numbered-Seat Series (Phase 6, Design Doc §6.5/§9.2). The
 * initial schema already had `sessions.series_id` (bare grouping key, no FK
 * — comment there explained no Series table existed yet) and
 * `seat_reservations` (no uniqueness constraint), but no series-level entity
 * to hold a name/creator/seat count, and no protection against two members
 * claiming the same seat on the same date concurrently. This closes both
 * gaps, same pattern as the earlier waitlist_entries uniqueness fix.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("series", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true },
    seat_count: { type: "integer", notNull: true },
    created_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("sessions", "sessions_series_id_fkey", {
    foreignKeys: {
      columns: "series_id",
      references: "series(id)",
      onDelete: "SET NULL",
    },
  });

  pgm.addConstraint("seat_reservations", "seat_reservations_session_id_seat_number_unique", {
    unique: ["session_id", "seat_number"],
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("seat_reservations", "seat_reservations_session_id_seat_number_unique");
  pgm.dropConstraint("sessions", "sessions_series_id_fkey");
  pgm.dropTable("series");
};
