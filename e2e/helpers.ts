import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { Secret, TOTP } from "otpauth";
import { hashPassword } from "@/lib/auth/password";

// Module-level singleton shared by every spec file that imports it.
// Deliberately never closed here or in any spec file's afterAll — Playwright
// reuses worker processes across test files, so a file that calls
// `pool.end()` in its own afterAll can poison a *different* file that later
// shares that same worker process ("Cannot use a pool after calling end on
// the pool"). Connections close naturally when the worker process exits.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function createTestUser(opts: {
  username: string;
  baseRole?: "AccountHolder" | "Admin";
  password?: string;
}) {
  // Test files run in parallel across workers/processes — a caller-supplied
  // `Date.now()`-based username alone isn't unique enough (seen colliding
  // across files in practice), so always add our own entropy on top.
  const username = `${opts.username}${Math.random().toString(36).slice(2, 8)}`;
  const password = opts.password ?? "e2e-test-password-123";
  const passwordHash = await hashPassword(password);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash, email, email_verified_at, base_role, status)
     VALUES ($1, $2, $3, now(), $4, 'Active')
     RETURNING id`,
    [username, passwordHash, `${username}@example.test`, opts.baseRole ?? "AccountHolder"],
  );
  return { id: result.rows[0].id, username, password };
}

function totpCodeFor(secretBase32: string): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32.trim()),
  }).generate();
}

/**
 * Logs in via the real UI. Handles both MFA cases transparently: first-time
 * enrollment (redirects to /auth/mfa-setup, same flow a real first-time
 * Admin/Controller login goes through) and a *returning* already-enrolled
 * account, which the login page prompts for a code on without navigating
 * anywhere — for that case this fetches the account's stored mfa_secret
 * directly (test-only shortcut; there's no way to read a live TOTP code
 * from the UI itself).
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

  const totpInput = page.getByLabel(/6-digit code/);
  await Promise.race([
    page.waitForURL(/\/(auth\/mfa-setup|dashboard)/),
    totpInput.waitFor({ state: "visible" }),
  ]);

  if (page.url().includes("/auth/mfa-setup")) {
    const secret = await page.locator("code").textContent();
    await page.getByLabel(/6-digit code/).fill(totpCodeFor(secret!));
    await page.getByRole("button", { name: "Confirm & enable MFA" }).click();
    await page.waitForURL("**/dashboard");
  } else if (await totpInput.isVisible().catch(() => false)) {
    const secretRow = await pool.query<{ mfa_secret: string | null }>(
      `SELECT mfa_secret FROM users WHERE username = $1`,
      [user.username],
    );
    await totpInput.fill(totpCodeFor(secretRow.rows[0].mfa_secret!));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL("**/dashboard");
  }
}

/** Formats a Date as the local-time string a datetime-local input expects. */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Creates a fresh Admin, logs in as them, and creates a one-off session via the real UI. */
export async function createOneOffSessionAsAdmin(
  page: Page,
  opts: { description: string; startTime: Date; capacity: number },
): Promise<string> {
  const admin = await createTestUser({
    username: `e2eadmin${Date.now()}${Math.random()}`,
    baseRole: "Admin",
  });
  await loginAsUser(page, admin);

  const endTime = new Date(opts.startTime.getTime() + 3 * 60 * 60 * 1000);
  await page.goto("/admin/sessions/new");
  await page.getByLabel("Description").fill(opts.description);
  await page.getByLabel("Start time").fill(toDatetimeLocal(opts.startTime));
  await page.getByLabel("End time").fill(toDatetimeLocal(endTime));
  await page.getByLabel("Capacity").fill(String(opts.capacity));
  await page.getByRole("button", { name: "Create session" }).click();
  await page.waitForURL("**/admin/sessions");

  const result = await pool.query<{ id: string }>(
    `SELECT id FROM sessions WHERE description = $1 ORDER BY start_time DESC LIMIT 1`,
    [opts.description],
  );
  return result.rows[0].id;
}
