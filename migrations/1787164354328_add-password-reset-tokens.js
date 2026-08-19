/**
 * Password reset flow — this app had no account-recovery mechanism at all
 * (docs/SecurityDocument.md never specified one either). Mirrors
 * email_verification_tokens' exact shape/reasoning: only the token's hash
 * is stored, never the raw value.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("password_reset_tokens", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    token_hash: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    consumed_at: { type: "timestamptz" },
  });
  pgm.createIndex("password_reset_tokens", "user_id");
  pgm.createIndex("password_reset_tokens", "token_hash", { unique: true });
};

exports.down = (pgm) => {
  pgm.dropTable("password_reset_tokens");
};
