import { pool } from "@/lib/db/pool";
import { generateSecret, verifyTotpCode } from "./totp";

/**
 * Reuses an in-progress enrollment's secret if one is already stored
 * (mfa_secret set but mfa_enabled still false) rather than generating a new
 * one on every page load — otherwise a refreshed QR code would invalidate
 * whatever the user just scanned.
 */
export async function getOrCreateMfaSecret(userId: string): Promise<string> {
  const existing = await pool.query<{ mfa_secret: string | null }>(
    `SELECT mfa_secret FROM users WHERE id = $1`,
    [userId],
  );
  const current = existing.rows[0]?.mfa_secret;
  if (current) return current;

  const secret = generateSecret();
  await pool.query(`UPDATE users SET mfa_secret = $1 WHERE id = $2`, [secret, userId]);
  return secret;
}

export async function confirmMfaEnrollment(userId: string, code: string): Promise<boolean> {
  const result = await pool.query<{ mfa_secret: string | null }>(
    `SELECT mfa_secret FROM users WHERE id = $1`,
    [userId],
  );
  const secret = result.rows[0]?.mfa_secret;
  if (!secret || !verifyTotpCode(secret, code)) return false;

  await pool.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [userId]);
  return true;
}
