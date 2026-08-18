/**
 * Prerequisite for the legacy data migration (docs/MigrationPlan.md §3).
 * `users` had no concept of a person's real name at all — legacy has real
 * firstName/lastName for every member, with nowhere to land them. A single
 * display_name column was chosen over separate first_name/last_name, since
 * this app doesn't otherwise need them split (see MigrationPlan.md §3.1).
 *
 * legacy_id mirrors the existing `models.legacy_id` precedent (initial
 * schema) — traces a migrated member back to their legacy row so a specific
 * account's data can be corrected post-cutover without re-deriving who's
 * who from scratch.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("users", {
    display_name: { type: "text" },
    legacy_id: { type: "varchar(255)" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("users", ["display_name", "legacy_id"]);
};
