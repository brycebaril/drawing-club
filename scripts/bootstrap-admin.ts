/**
 * One-off: creates exactly one real ADMIN account against a fresh
 * production database. Needed because, during static-only launch mode
 * (src/lib/launchMode.ts), /auth/register is closed and there's otherwise
 * no way to get the first real credential in — `pnpm seed` is unsafe to run
 * against real prod (every seeded account shares one hardcoded dev
 * password). Errors loudly rather than silently no-op'ing if the username
 * is already taken, since that'd otherwise look like success while doing
 * nothing.
 *
 * Usage:
 *   pnpm bootstrap-admin --username=alice --email=alice@example.org --password='...'
 */
import { hashPassword } from "../src/lib/auth/password";
import { pool } from "../src/lib/db/pool";
import { isValidEmail } from "../src/lib/validation/email";

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main() {
  const username = argValue("username");
  const email = argValue("email");
  const password = argValue("password");

  if (!username || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    throw new Error("Pass --username=<3-32 chars, letters/numbers/underscores>");
  }
  if (!email || !isValidEmail(email)) {
    throw new Error("Pass --email=<valid email address>");
  }
  if (!password || password.length < 8) {
    throw new Error("Pass --password=<at least 8 characters>");
  }

  const existing = await pool.query(`SELECT id FROM users WHERE username = $1 OR email = $2`, [username, email]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new Error(`A user with that username or email already exists — refusing to overwrite it.`);
  }

  const passwordHash = await hashPassword(password);
  const result = await pool.query<{ id: string; username: string }>(
    `INSERT INTO users (username, password_hash, email, display_name, base_role, status, email_verified_at)
     VALUES ($1, $2, $3, $1, 'Admin', 'Active', now())
     RETURNING id, username`,
    [username, passwordHash, email],
  );

  console.log("Created ADMIN account:", result.rows[0]);
}

main()
  .catch((error) => {
    console.error("bootstrap-admin failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
