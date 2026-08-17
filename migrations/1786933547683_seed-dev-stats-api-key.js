// eslint-disable-next-line @typescript-eslint/no-require-imports -- migrations are plain CommonJS, no ESM import available here
const { createHash } = require("node:crypto");

/**
 * Seeds a fixed-value local-dev API key so a fresh Claude Code session (the
 * priority consumer this API was built for) can query /api/stats/* right
 * away without a UI round-trip through /admin/api-keys first — same "seed
 * for local dev convenience" precedent as the ops-workspace models/
 * volunteer-role seeding. Not for production use; a real deployment issues
 * real keys via /admin/api-keys instead.
 */
const DEV_KEY = "dev-stats-api-key-do-not-use-in-production";
const SCOPES = ["users", "attendance", "revenue", "audit_logs", "flags"];

exports.shorthands = undefined;

exports.up = (pgm) => {
  const keyHash = createHash("sha256").update(DEV_KEY).digest("hex");
  const keyPrefix = DEV_KEY.slice(0, 12);

  pgm.sql(
    `INSERT INTO api_keys (name, key_hash, key_prefix, scopes)
     VALUES ('Local dev (Claude Code)', '${keyHash}', '${keyPrefix}', ARRAY[${SCOPES.map((s) => `'${s}'`).join(",")}])`,
  );
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM api_keys WHERE name = 'Local dev (Claude Code)'`);
};
