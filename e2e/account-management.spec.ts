import { expect, test } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { createTestUser, loginAsUser, pool } from "./helpers";

function totpCodeFor(secretBase32: string): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32.trim()),
  }).generate();
}

test("a member changes their own password while logged in, then logs in with the new one", async ({ page }) => {
  const user = await createTestUser({ username: `e2echangepw${Date.now()}`, password: "old-password-123" });
  await loginAsUser(page, user);

  await page.getByLabel("Current password").fill("old-password-123");
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password-456");
  await page.getByLabel("Confirm new password").fill("brand-new-password-456");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();

  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill("brand-new-password-456");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
});

test("changing your password requires the current one to be correct", async ({ page }) => {
  const user = await createTestUser({ username: `e2ewrongcurrentpw${Date.now()}` });
  await loginAsUser(page, user);

  await page.getByLabel("Current password").fill("definitely-not-the-real-password");
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password-456");
  await page.getByLabel("Confirm new password").fill("brand-new-password-456");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Current password is incorrect.")).toBeVisible();
});

test("a non-admin who voluntarily enrolls in MFA is actually challenged for a code on their next login", async ({
  page,
}) => {
  // Regression test for a real, previously-shipped bug: the login gate used
  // to be "mfaRequired && mfaEnabled" — since mfaRequired is false for a
  // plain member, enrolling had zero effect at login. This test hangs/fails
  // if that regresses, since loginAsUser's second call only proceeds past
  // the TOTP step if the login page actually shows one.
  const user = await createTestUser({ username: `e2emfamember${Date.now()}` });
  await loginAsUser(page, user);

  await expect(page.getByText("Two-factor authentication is off.")).toBeVisible();
  await page.getByRole("link", { name: "Enable two-factor authentication" }).click();
  await page.waitForURL("**/auth/mfa-setup");

  // Voluntary enrollment's own copy, not the mandatory-role copy.
  await expect(page.getByText("Add an extra layer of security")).toBeVisible();

  const secret = await page.locator("code").textContent();
  await page.getByLabel(/6-digit code/).fill(totpCodeFor(secret!));
  await page.getByRole("button", { name: "Confirm & enable MFA" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible();

  // The actual regression check: log back in via the shared helper, which
  // only completes past a TOTP prompt if one is actually shown.
  await loginAsUser(page, user);
  await expect(page).toHaveURL(/\/dashboard/);

  // And it can be turned back off, since it was never mandatory for this role.
  await page.getByRole("button", { name: "Disable two-factor authentication" }).click();
  await expect(page.getByText("Two-factor authentication is off.")).toBeVisible();
});

test("an Admin has no way to disable their mandatory MFA from the dashboard", async ({ page }) => {
  const admin = await createTestUser({ username: `e2emfaadminnodisable${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable two-factor authentication" })).toHaveCount(0);
});

test("a member requests account cancellation, an admin sees and anonymizes it, and the account can no longer log in", async ({
  page,
}) => {
  const member = await createTestUser({ username: `e2ecancelme${Date.now()}` });
  await loginAsUser(page, member);

  await page.getByLabel("Why are you canceling?").fill("No longer in the area");
  await page.getByRole("button", { name: "Request account cancellation" }).click();
  await expect(page.getByText(/You requested account cancellation on/)).toBeVisible();

  const admin = await createTestUser({ username: `e2ecanceladmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  await page.goto(`/admin/users/${member.id}`);
  await expect(page.getByText(/Cancellation requested on/)).toBeVisible();
  await expect(page.getByText("No longer in the area")).toBeVisible();

  await page.getByLabel("Reason (required)").last().fill("Member-requested closure");
  await page.getByLabel(/I understand this permanently scrubs/).check();
  await page.getByRole("button", { name: "Anonymize & close account" }).click();
  await page.waitForURL(`**/admin/users/${member.id}`);
  await expect(page.getByText("Deleted", { exact: true }).first()).toBeVisible();

  await expect(async () => {
    const row = await pool.query<{ status: string; email: string }>(`SELECT status, email FROM users WHERE id = $1`, [
      member.id,
    ]);
    expect(row.rows[0].status).toBe("Deleted");
    expect(row.rows[0].email).toBe(`deleted-${member.id}@deleted.invalid`);
  }).toPass({ timeout: 5000 });

  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(member.username);
  await page.getByLabel("Password").fill(member.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
});
