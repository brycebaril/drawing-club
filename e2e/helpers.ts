import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { Secret, TOTP } from "otpauth";
import { hashPassword } from "@/lib/auth/password";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function createTestUser(opts: {
  username: string;
  baseRole?: "AccountHolder" | "Admin";
  password?: string;
}) {
  const password = opts.password ?? "e2e-test-password-123";
  const passwordHash = await hashPassword(password);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash, email, email_verified_at, base_role, status)
     VALUES ($1, $2, $3, now(), $4, 'Active')
     RETURNING id`,
    [opts.username, passwordHash, `${opts.username}@example.test`, opts.baseRole ?? "AccountHolder"],
  );
  return { id: result.rows[0].id, username: opts.username, password };
}

/**
 * Logs in via the real UI and transparently completes MFA enrollment if
 * this account requires it and hasn't enrolled yet (same flow a real
 * first-time Admin/Controller login goes through).
 */
export async function loginAsUser(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  // /auth/login is guest-only (src/lib/auth/rbac.ts) — clear any previous
  // user's session first, or the page redirects straight past the form.
  await page.context().clearCookies();
  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await page.waitForURL(/\/(auth\/mfa-setup|dashboard)/);
  if (page.url().includes("/auth/mfa-setup")) {
    const secret = await page.locator("code").textContent();
    const code = new TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret!.trim()),
    }).generate();
    await page.getByLabel(/6-digit code/).fill(code);
    await page.getByRole("button", { name: "Confirm & enable MFA" }).click();
    await page.waitForURL("**/dashboard");
  }
}
