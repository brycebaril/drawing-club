/**
 * Design Doc §10 / ArchitectureDocument.md §9: the Stats API authenticates
 * external tools/scripts with admin-issued, scoped Bearer-token API keys —
 * a separate mechanism from the member-facing Auth.js session flow. Keys
 * are hashed at rest (SHA-256, same posture as passes.claim_code) —
 * key_prefix lets the admin UI identify a key without ever re-showing the
 * full value after creation.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("api_keys", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true },
    key_hash: { type: "text", notNull: true, unique: true },
    key_prefix: { type: "varchar(12)", notNull: true },
    scopes: { type: "text[]", notNull: true },
    created_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    revoked_at: { type: "timestamptz" },
    last_used_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("api_keys");
};
