import { expect, test } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("registering creates an account and signs the user in", async ({ page }) => {
  const username = `e2euser${Date.now()}`;
  await page.goto("/auth/register");
  await page.getByLabel("Name", { exact: true }).fill("E2E User");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email", { exact: true }).fill(`${username}@example.test`);
  await page.getByLabel("Password").fill("a-decent-password");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/dashboard");
  // The dashboard shows memberLabel(displayName, username) — display name
  // when set, not the raw username (src/lib/users/memberLabel.ts). This
  // assertion was checking the username, a stale leftover from before that
  // change (a real, previously undiscovered break — found while separately
  // debugging an account-management e2e run).
  await expect(page.getByText("Logged in as E2E User")).toBeVisible();
});

test("registering with marketing email opt-in checked captures real consent", async ({ page }) => {
  const username = `e2emarketingoptin${Date.now()}`;
  await page.goto("/auth/register");
  await page.getByLabel("Name", { exact: true }).fill("E2E Opt-In User");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email", { exact: true }).fill(`${username}@example.test`);
  await page.getByLabel("Password").fill("a-decent-password");
  await page.getByLabel("Send me occasional email about upcoming events and news").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  const row = await pool.query<{ marketing_email_opt_in: boolean }>(
    `SELECT marketing_email_opt_in FROM users WHERE username = $1`,
    [username],
  );
  expect(row.rows[0].marketing_email_opt_in).toBe(true);
});

test("registering without checking the marketing opt-in defaults to no consent", async ({ page }) => {
  const username = `e2emarketingoptout${Date.now()}`;
  await page.goto("/auth/register");
  await page.getByLabel("Name", { exact: true }).fill("E2E Opt-Out User");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email", { exact: true }).fill(`${username}@example.test`);
  await page.getByLabel("Password").fill("a-decent-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  const row = await pool.query<{ marketing_email_opt_in: boolean }>(
    `SELECT marketing_email_opt_in FROM users WHERE username = $1`,
    [username],
  );
  expect(row.rows[0].marketing_email_opt_in).toBe(false);
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
  await loginAsUser(page, user);

  await pool.query(`UPDATE users SET status = 'Banned' WHERE id = $1`, [user.id]);

  await page.goto("/dashboard");
  await page.waitForURL("**/auth/login**");
});
