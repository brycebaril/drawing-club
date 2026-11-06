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

/**
 * Turns MFA back off for a voluntary (non-mandatory-role) enrollment.
 * Callers must check `!ctx.mfaRequired` before calling this — refusing here
 * too (rather than trusting the caller) so a role check never gets
 * accidentally dropped from just one call site. Without it, an ADMIN/
 * VOL_CTRL could disable MFA and immediately get bounced back to
 * /auth/mfa-setup by src/proxy.ts's forced-enrollment redirect on their very
 * next request — same end state, just a confusing enable/disable/re-enable
 * loop instead of a clear "your role requires this" message up front.
 */
export async function disableMfa(userId: string, mfaRequired: boolean): Promise<{ ok: boolean; error?: string }> {
  if (mfaRequired) {
    return { ok: false, error: "Your role requires two-factor authentication — it can't be disabled." };
  }
  await pool.query(`UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1`, [userId]);
  return { ok: true };
}
