/**
 * claim_attempts existed only to rate-limit claim-code redemption
 * (migrations/1786915932907_claim-attempts.js). Direct-ownership pass
 * transfers (migrations/1786993348841_pass-direct-transfers.js) removed
 * claim-code redemption entirely, leaving this table with no writer and
 * isClaimRateLimited/recordClaimAttempt (src/lib/auth/rateLimit.ts) with no
 * caller — dropped for the same reason the code was deleted rather than
 * left dead.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropTable("claim_attempts");
};

exports.down = (pgm) => {
  pgm.createTable("claim_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    ip_address: { type: "varchar(45)" },
    succeeded: { type: "boolean", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("claim_attempts", ["ip_address", "created_at"]);
};
