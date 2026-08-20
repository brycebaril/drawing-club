import { randomBytes, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { hashPassword, verifyPassword } from "./password";
import { consumeResetToken, requestPasswordReset } from "./passwordReset";

let userId: string;
let username: string;
let email: string;

beforeEach(async () => {
  const passwordHash = await hashPassword("original-password");
  const unique = `reset-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  username = unique;
  email = `${unique}@example.test`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash, email, base_role, status)
     VALUES ($1, $2, $3, 'AccountHolder', 'Active')
     RETURNING id`,
    [username, passwordHash, email],
  );
  userId = result.rows[0].id;
});

afterEach(() => pool.query(`DELETE FROM users WHERE id = $1`, [userId]));

async function tokenCountFor(id: string): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT count(*) FROM password_reset_tokens WHERE user_id = $1`, [
    id,
  ]);
  return Number(result.rows[0].count);
}

describe("requestPasswordReset", () => {
  it("creates a token for a real account, matched by username", async () => {
    await requestPasswordReset(username);
    expect(await tokenCountFor(userId)).toBe(1);
  });

  it("creates a token for a real account, matched by email", async () => {
    await requestPasswordReset(email);
    expect(await tokenCountFor(userId)).toBe(1);
  });

  it("matches email case-insensitively (username stays case-sensitive)", async () => {
    await requestPasswordReset(email.toUpperCase());
    expect(await tokenCountFor(userId)).toBe(1);
  });

  it("does not match username with the wrong case", async () => {
    await requestPasswordReset(username.toUpperCase());
    expect(await tokenCountFor(userId)).toBe(0);
  });

  it("is a silent no-op for an unknown identifier", async () => {
    await expect(requestPasswordReset("no-such-account-at-all")).resolves.toBeUndefined();
  });

  it("caps outstanding tokens per account rather than accumulating unboundedly", async () => {
    for (let i = 0; i < 5; i += 1) {
      await requestPasswordReset(username);
    }
    expect(await tokenCountFor(userId)).toBe(3);
  });
});

describe("consumeResetToken", () => {
  it("sets a new password and invalidates every other outstanding token for the account", async () => {
    await requestPasswordReset(username);
    await requestPasswordReset(username);

    const rows = await pool.query<{ id: string }>(`SELECT id FROM password_reset_tokens WHERE user_id = $1`, [
      userId,
    ]);
    expect(rows.rowCount).toBe(2);

    // Recover a raw token to consume by inserting our own known one — the
    // real tokens are only ever held as hashes past creation, so we can't
    // recover them from the two requestPasswordReset calls above directly.
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [userId, tokenHash],
    );

    const result = await consumeResetToken(rawToken, "brand-new-password");
    expect(result).toBe("reset");

    const userRow = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [
      userId,
    ]);
    expect(await verifyPassword(userRow.rows[0].password_hash, "brand-new-password")).toBe(true);

    const stillOutstanding = await pool.query<{ count: string }>(
      `SELECT count(*) FROM password_reset_tokens WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId],
    );
    expect(Number(stillOutstanding.rows[0].count)).toBe(0);
  });

  it("rejects an unknown token", async () => {
    expect(await consumeResetToken("not-a-real-token", "irrelevant")).toBe("invalid");
  });

  it("rejects a token that was already consumed", async () => {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [userId, tokenHash],
    );

    expect(await consumeResetToken(rawToken, "first-password")).toBe("reset");
    expect(await consumeResetToken(rawToken, "second-password")).toBe("already-used");
  });

  it("rejects an expired token", async () => {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 hour')`,
      [userId, tokenHash],
    );

    expect(await consumeResetToken(rawToken, "irrelevant")).toBe("expired");
  });
});
