/**
 * SecurityDocument.md §2: claim codes are "effectively a second credential
 * surface" and need the same brute-force protection as login. Mirrors
 * login_attempts (migrations/1786819723052_auth-infra-tables.js) but has no
 * identifier column — unlike a username, there's no meaningful
 * pre-verification identity to key on for a claim attempt, so this is
 * IP-scoped only.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("claim_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    ip_address: { type: "varchar(45)" },
    succeeded: { type: "boolean", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("claim_attempts", ["ip_address", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("claim_attempts");
};
