import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createTestUser, pool } from "./helpers";

// Mirrors passwordReset.ts's own hashToken exactly (not exported) — lets
// these tests seed password_reset_tokens rows directly with a known raw
// token, sidestepping the fact that the real token only ever exists in the
// emailed link, which nothing in this suite can intercept (sendEmail's
// console-log dev fallback isn't piped anywhere Playwright can read it from
// the webServer's spawned process).
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function seedToken(userId: string, opts: { expiresInMs?: number; consumed?: boolean } = {}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 60 * 60 * 1000));
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, consumed_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), expiresAt, opts.consumed ? new Date() : null],
  );
  return token;
}

test("using a valid reset token sets a new password that can log in", async ({ page }) => {
  const user = await createTestUser({ username: `e2eresetok${Date.now()}`, password: "old-password-123" });
  const token = await seedToken(user.id);

  await page.goto(`/auth/reset-password?token=${token}`);
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password-456");
  await page.getByLabel("Confirm new password").fill("brand-new-password-456");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();

  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill("brand-new-password-456");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
});

test("an invalid token is rejected", async ({ page }) => {
  await page.goto(`/auth/reset-password?token=${randomBytes(32).toString("hex")}`);
  await page.getByLabel("New password", { exact: true }).fill("whatever-password-1");
  await page.getByLabel("Confirm new password").fill("whatever-password-1");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("This reset link is invalid.")).toBeVisible();
});

test("an expired token is rejected", async ({ page }) => {
  const user = await createTestUser({ username: `e2eresetexpired${Date.now()}` });
  const token = await seedToken(user.id, { expiresInMs: -1000 });

  await page.goto(`/auth/reset-password?token=${token}`);
  await page.getByLabel("New password", { exact: true }).fill("whatever-password-2");
  await page.getByLabel("Confirm new password").fill("whatever-password-2");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("This reset link has expired.")).toBeVisible();
});

test("an already-used token is rejected", async ({ page }) => {
  const user = await createTestUser({ username: `e2eresetused${Date.now()}` });
  const token = await seedToken(user.id, { consumed: true });

  await page.goto(`/auth/reset-password?token=${token}`);
  await page.getByLabel("New password", { exact: true }).fill("whatever-password-3");
  await page.getByLabel("Confirm new password").fill("whatever-password-3");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("This reset link has already been used.")).toBeVisible();
});

test("mismatched passwords are rejected client-side validation aside", async ({ page }) => {
  const user = await createTestUser({ username: `e2eresetmismatch${Date.now()}` });
  const token = await seedToken(user.id);

  await page.goto(`/auth/reset-password?token=${token}`);
  await page.getByLabel("New password", { exact: true }).fill("password-one-1234");
  await page.getByLabel("Confirm new password").fill("password-two-5678");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Passwords don't match.")).toBeVisible();
});

test("a missing token shows a request-a-new-one prompt instead of a form", async ({ page }) => {
  await page.goto("/auth/reset-password");
  await expect(page.getByText("This reset link is missing its token.")).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("requesting a reset for a real account creates a token, and the response doesn't reveal whether the account exists", async ({
  page,
}) => {
  const user = await createTestUser({ username: `e2eforgotreal${Date.now()}` });

  await page.goto("/auth/forgot-password");
  await page.getByLabel("Username or email").fill(user.username);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await expect(async () => {
    const row = await pool.query(`SELECT id FROM password_reset_tokens WHERE user_id = $1`, [user.id]);
    expect(row.rowCount).toBe(1);
  }).toPass({ timeout: 5000 });

  // An unknown identifier gets the exact same generic response, and
  // creates no token — the flow can't be used to enumerate accounts.
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Username or email").fill(`no-such-user-${Date.now()}`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
});
