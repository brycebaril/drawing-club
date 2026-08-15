import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { Secret, TOTP } from "otpauth";
import { hashPassword } from "@/lib/auth/password";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createTestUser(opts: {
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

test.afterAll(() => pool.end());

test("registering creates an account and signs the user in", async ({ page }) => {
  const username = `e2euser${Date.now()}`;
  await page.goto("/auth/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.test`);
  await page.getByLabel("Password").fill("a-decent-password");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByText(`Logged in as ${username}`)).toBeVisible();
});

test("unauthenticated visit to /dashboard redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/auth/login**");
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/dashboard");
});

test("an Admin without MFA enrolled is forced through setup before reaching the dashboard", async ({
  page,
}) => {
  const user = await createTestUser({ username: `e2eadmin${Date.now()}`, baseRole: "Admin" });

  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await page.waitForURL("**/auth/mfa-setup");

  const secret = await page.locator("code").textContent();
  expect(secret).toBeTruthy();

  const code = new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret!.trim()),
  }).generate();

  await page.getByLabel(/6-digit code/).fill(code);
  await page.getByRole("button", { name: "Confirm & enable MFA" }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByText(/Roles:.*ADMIN/)).toBeVisible();
});

test("a banned account's existing session loses access on the next request", async ({ page }) => {
  const user = await createTestUser({ username: `e2ebanme${Date.now()}` });

  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");

  await pool.query(`UPDATE users SET status = 'Banned' WHERE id = $1`, [user.id]);

  await page.goto("/dashboard");
  await page.waitForURL("**/auth/login**");
});
