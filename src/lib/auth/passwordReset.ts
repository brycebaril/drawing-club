import { randomBytes, createHash } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { ORG_DBA_NAME } from "@/lib/org";
import { sendEmail } from "@/lib/email/sender";
import { hashPassword } from "./password";

// Shorter than email verification's 24h window (src/lib/email/verification.ts)
// — a password-reset token is a higher-value secret than an email-confirm
// link, same reasoning most account-recovery flows use a tighter TTL.
const TOKEN_TTL_HOURS = 1;

// Caps how many outstanding (not yet expired/consumed) reset tokens a
// single account can accumulate in one window — cheap protection against
// spamming someone's inbox with reset emails, without a dedicated
// rate-limit table (this codebase deliberately dropped a similar
// claim_attempts table once claim codes stopped existing — see CLAUDE.md's
// Pass sharing notes — so a query against the token table itself, rather
// than a new counter table, matches that "least machinery" precedent).
const MAX_OUTSTANDING_TOKENS = 3;
const OUTSTANDING_WINDOW_MINUTES = 15;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Looks up an account by username OR email (matching src/auth.ts's login
 * lookup) and, if under the outstanding-token cap, creates and emails a
 * reset link. Deliberately does NOT report whether a matching account was
 * found — the caller (requestPasswordResetAction) always shows the same
 * generic message either way, so this flow can't be used to enumerate
 * registered usernames/emails.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const userResult = await pool.query<{ id: string; email: string; username: string }>(
    `SELECT id, email, username FROM users WHERE username = $1 OR email = $1`,
    [identifier],
  );
  if (userResult.rowCount === 0) return;
  const user = userResult.rows[0];

  const outstandingResult = await pool.query<{ count: string }>(
    `SELECT count(*) FROM password_reset_tokens
     WHERE user_id = $1 AND consumed_at IS NULL AND created_at > now() - ($2 || ' minutes')::interval`,
    [user.id, OUTSTANDING_WINDOW_MINUTES],
  );
  if (Number(outstandingResult.rows[0].count) >= MAX_OUTSTANDING_TOKENS) return;

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt],
  );

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

  await sendEmail({
    to: user.email,
    subject: `Reset your ${ORG_DBA_NAME} password`,
    body: `Hi ${user.username},\n\nSomeone (hopefully you) asked to reset your password:\n${resetUrl}\n\nThis link expires in ${TOKEN_TTL_HOURS} hour${TOKEN_TTL_HOURS === 1 ? "" : "s"}. If you didn't request this, you can ignore this email — your password hasn't changed.`,
  });
}

export type ResetPasswordResult = "reset" | "invalid" | "expired" | "already-used";

/**
 * Consumes a reset token: validates it, sets the new password, and
 * invalidates every other outstanding token for the same account (so an
 * older, still-unexpired link can't also be used after this one succeeds).
 * Same row-locking discipline as consumeVerificationToken.
 */
export async function consumeResetToken(token: string, newPassword: string): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenRow = await client.query(
      `SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );

    if (tokenRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return "invalid";
    }

    const row = tokenRow.rows[0];
    if (row.consumed_at) {
      await client.query("ROLLBACK");
      return "already-used";
    }
    if (new Date(row.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return "expired";
    }

    const passwordHash = await hashPassword(newPassword);

    await client.query(
      `UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
      [row.user_id],
    );
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, row.user_id]);

    await client.query("COMMIT");
    return "reset";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
