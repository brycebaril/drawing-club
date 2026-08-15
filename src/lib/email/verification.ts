import { randomBytes, createHash } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { sendEmail } from "./sender";

const TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a verification token row and returns the raw token. Split out from
 * sendVerificationEmail so tests can drive the create -> consume round trip
 * directly instead of scraping the console-logged email body for the token.
 * The raw token is only ever held in memory/the email body — the DB stores
 * just its hash, same reasoning as password storage (docs/SecurityDocument.md §2).
 */
export async function createVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  return token;
}

export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  username: string;
}): Promise<void> {
  const token = await createVerificationToken(user.id);

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  await sendEmail({
    to: user.email,
    subject: "Verify your Life Drawing Society account",
    body: `Hi ${user.username},\n\nVerify your email to book sessions and buy passes:\n${verifyUrl}\n\nThis link expires in ${TOKEN_TTL_HOURS} hours.`,
  });
}

export type VerifyEmailResult = "verified" | "invalid" | "expired" | "already-used";

/**
 * Consumes a verification token: marks it used and sets the user's
 * email_verified_at. Returns why it succeeded/failed rather than throwing,
 * so the route handler can show a specific message.
 */
export async function consumeVerificationToken(token: string): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenRow = await client.query(
      `SELECT id, user_id, expires_at, consumed_at FROM email_verification_tokens
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

    await client.query(
      `UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1`,
      [row.id],
    );
    await client.query(
      `UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`,
      [row.user_id],
    );

    await client.query("COMMIT");
    return "verified";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
