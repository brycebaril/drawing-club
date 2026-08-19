/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Login now accepts email as an alternate identifier alongside username
  // (src/auth.ts, src/app/api/auth/check-credentials/route.ts) — migrated
  // legacy members only ever knew their email, never the derived username.
  // `username = $1 OR email = $1` is only unambiguous if email is unique;
  // registerAction already rejected duplicate emails at the app level, but
  // nothing enforced it at the DB level. Verified zero duplicates exist in
  // the live drawing_club database before adding this (see MigrationPlan.md).
  pgm.addConstraint("users", "users_email_unique", {
    unique: "email",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint("users", "users_email_unique");
};
