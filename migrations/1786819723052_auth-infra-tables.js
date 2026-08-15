/**
 * Auth infrastructure tables — not part of DesignDocument.md §13's business
 * schema, so they live in their own migration rather than being folded into
 * the initial one. See docs/SecurityDocument.md §2 (MFA, brute-force
 * protection) and Design Doc §5.1 (email verification).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("users", {
    mfa_secret: { type: "text" },
  });

  pgm.createTable("email_verification_tokens", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    token_hash: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    consumed_at: { type: "timestamptz" },
  });
  pgm.createIndex("email_verification_tokens", "user_id");
  pgm.createIndex("email_verification_tokens", "token_hash", { unique: true });

  pgm.createTable("login_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    identifier: { type: "varchar(255)", notNull: true },
    ip_address: { type: "varchar(45)" },
    succeeded: { type: "boolean", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("login_attempts", ["identifier", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("login_attempts");
  pgm.dropTable("email_verification_tokens");
  pgm.dropColumn("users", "mfa_secret");
};
