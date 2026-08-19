import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { hashPassword } from "@/lib/auth/password";
import { consumeVerificationToken, createVerificationToken } from "./verification";

let userId: string;

beforeEach(async () => {
  const passwordHash = await hashPassword("irrelevant-for-this-test");
  const unique = `verify-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash, email, base_role, status)
     VALUES ($1, $2, $3, 'AccountHolder', 'Active')
     RETURNING id`,
    [unique, passwordHash, `${unique}@example.test`],
  );
  userId = result.rows[0].id;
});

// This suite runs against the real dev DB (this codebase's established
// test convention, not a separate test DB) — without cleanup these rows
// leak permanently. That's exactly how 39 stray verify-test-* accounts
// ended up in the live drawing_club database earlier (found and deleted
// during the login-by-email fix's pre-implementation duplicate-email check).
afterEach(() => pool.query(`DELETE FROM users WHERE id = $1`, [userId]));

afterAll(() => pool.end());

describe("verification token create/consume round trip", () => {
  it("consuming a fresh token verifies the user's email", async () => {
    const token = await createVerificationToken(userId);

    const before = await pool.query<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(before.rows[0].email_verified_at).toBeNull();

    const result = await consumeVerificationToken(token);
    expect(result).toBe("verified");

    const after = await pool.query<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(after.rows[0].email_verified_at).not.toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await consumeVerificationToken("not-a-real-token")).toBe("invalid");
  });

  it("rejects a token that was already consumed", async () => {
    const token = await createVerificationToken(userId);
    expect(await consumeVerificationToken(token)).toBe("verified");
    expect(await consumeVerificationToken(token)).toBe("already-used");
  });
});
