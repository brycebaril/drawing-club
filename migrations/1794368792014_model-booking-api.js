/**
 * Model Booking API (docs/superpowers/specs/2026-11-10-model-booking-api-design.md):
 * this app's models table becomes the official roster, written by the legacy
 * system's tooling over /api/model-booking/*. That needs structured contact
 * fields (contact_info was "email / phone" in one string), a retired flag,
 * legacy_id unique so his ids can't collide, and sessions.legacy_id so he can
 * match his existing session records to ours across staging reloads.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("models", {
    email: { type: "varchar(255)" },
    phone: { type: "varchar(255)" },
    retired_at: { type: "timestamptz" },
  });
  // Legacy migration wrote "email / phone"; seed wrote just "email".
  pgm.sql(`
    UPDATE models
    SET email = NULLIF(split_part(contact_info, ' / ', 1), ''),
        phone = NULLIF(split_part(contact_info, ' / ', 2), '')
  `);
  pgm.dropColumn("models", "contact_info");
  pgm.createIndex("models", "legacy_id", {
    name: "models_legacy_id_unique",
    unique: true,
    where: "legacy_id IS NOT NULL",
  });
  pgm.addColumn("sessions", { legacy_id: { type: "varchar(255)" } });
};

exports.down = (pgm) => {
  pgm.dropColumn("sessions", "legacy_id");
  pgm.dropIndex("models", "legacy_id", { name: "models_legacy_id_unique" });
  pgm.addColumn("models", { contact_info: { type: "varchar(255)" } });
  pgm.sql(`UPDATE models SET contact_info = NULLIF(concat_ws(' / ', email, phone), '')`);
  pgm.dropColumns("models", ["email", "phone", "retired_at"]);
};
