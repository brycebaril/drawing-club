/**
 * Code-review finding: login/check-credentials/password-reset all match
 * `email = $1` case-sensitively, with no normalization anywhere in the
 * app. A legacy email stored with arbitrary casing (plausible from the
 * dump — see docs/MigrationPlan.md) can't be logged into by someone
 * typing it back in a different case, for exactly the migrated-member
 * population the email-login feature (users_email_unique's own migration)
 * was built for.
 *
 * Fixes this at the source: a case-insensitive unique index on
 * lower(email), which subsumes (and replaces) the plain case-sensitive
 * unique constraint added earlier. Verified zero case-variant email
 * collisions exist in the real dev DB before adding this, same discipline
 * as the original users_email_unique migration.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropConstraint("users", "users_email_unique");
  pgm.createIndex("users", "lower(email)", { unique: true, name: "users_email_lower_unique" });
};

exports.down = (pgm) => {
  pgm.dropIndex("users", "lower(email)", { name: "users_email_lower_unique" });
  pgm.addConstraint("users", "users_email_unique", { unique: "email" });
};
