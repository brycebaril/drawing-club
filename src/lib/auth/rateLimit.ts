import { pool } from "@/lib/db/pool";

// docs/SecurityDocument.md §2: rate-limit/lock login (and pass-claim, later)
// attempts per account/IP. A Postgres-backed sliding window rather than
// in-memory, since Amplify can run more than one instance
// (docs/ArchitectureDocument.md §11).
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export async function recordLoginAttempt(
  identifier: string,
  ipAddress: string | null,
  succeeded: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO login_attempts (identifier, ip_address, succeeded) VALUES ($1, $2, $3)`,
    [identifier.toLowerCase(), ipAddress, succeeded],
  );
}

/** True if this identifier (or IP) has too many recent failed attempts. */
export async function isLoginRateLimited(
  identifier: string,
  ipAddress: string | null,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT count(*)::int AS failures
     FROM login_attempts
     WHERE succeeded = false
       AND created_at > now() - ($1 || ' minutes')::interval
       AND (identifier = $2 OR ($3::varchar IS NOT NULL AND ip_address = $3))`,
    [WINDOW_MINUTES, identifier.toLowerCase(), ipAddress],
  );
  return result.rows[0].failures >= MAX_FAILED_ATTEMPTS;
}

/**
 * Same brute-force protection, applied to claim-code redemption
 * (SecurityDocument.md §2 — a claim code is "effectively a second
 * credential surface"). IP-only, unlike login: a claim attempt has no
 * pre-verification identity to key on the way a username does.
 */
export async function recordClaimAttempt(ipAddress: string | null, succeeded: boolean): Promise<void> {
  await pool.query(`INSERT INTO claim_attempts (ip_address, succeeded) VALUES ($1, $2)`, [
    ipAddress,
    succeeded,
  ]);
}

export async function isClaimRateLimited(ipAddress: string | null): Promise<boolean> {
  // IS NOT DISTINCT FROM, not `=` — this is IP-only (no identifier
  // fallback like login has), so a plain `=` would silently never match
  // (and never rate-limit) when ipAddress is null, which is the normal
  // case locally/in tests (src/lib/auth/clientIp.ts has no proxy headers
  // to read there).
  const result = await pool.query(
    `SELECT count(*)::int AS failures
     FROM claim_attempts
     WHERE succeeded = false
       AND created_at > now() - ($1 || ' minutes')::interval
       AND ip_address IS NOT DISTINCT FROM $2`,
    [WINDOW_MINUTES, ipAddress],
  );
  return result.rows[0].failures >= MAX_FAILED_ATTEMPTS;
}
