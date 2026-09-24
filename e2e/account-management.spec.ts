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

/**
 * The dashboard's Account settings section is a native <details>, closed by
 * default on every fresh page render (including the one after every
 * same-URL server-action redirect back to /dashboard — this app has several
 * of those). Scoped to "main details" — SiteNav's own "☰ Staff" menu is
 * ALSO a <details> (a real strict-mode collision found here, only visible
 * for an admin/ops viewer, since that's the only case with two on the page
 * at once). Setting .open directly (idempotent) rather than clicking the
 * <summary> (a toggle) avoids a second real race: a click landing right as
 * a same-URL redirect's fresh page is still swapping in can end up closing
 * an already-open section instead of opening a closed one. Wrapped in
 * toPass() because the .evaluate() call itself can still land on the
 * pre-redirect page an instant before the swap — retrying the whole
 * open-then-verify sequence, not just the open, is what actually closes
 * that race (a bare retry-the-open-only version left `expectVisible`
 * checks immediately after a redirect flaky in practice).
 */
async function openAccountSettings(page: import("@playwright/test").Page, expectVisible?: string | RegExp) {
  await expect(async () => {
    await page.locator("main details").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    if (expectVisible) {
      await expect(page.getByText(expectVisible)).toBeVisible({ timeout: 1000 });
    }
  }).toPass({ timeout: 10000 });
}

test("a member changes their own password while logged in, then logs in with the new one", async ({ page }) => {
  const user = await createTestUser({ username: `e2echangepw${Date.now()}`, password: "old-password-123" });
  await loginAsUser(page, user);

  await openAccountSettings(page);
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

  await openAccountSettings(page);
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

  await openAccountSettings(page, "Two-factor authentication is off.");
  await page.getByRole("link", { name: "Enable two-factor authentication" }).click();
  await page.waitForURL("**/auth/mfa-setup");

  // Voluntary enrollment's own copy, not the mandatory-role copy.
  await expect(page.getByText("Add an extra layer of security")).toBeVisible();

  const secret = await page.locator("code").textContent();
  await page.getByLabel(/6-digit code/).fill(totpCodeFor(secret!));
  await page.getByRole("button", { name: "Confirm & enable MFA" }).click();
  await page.waitForURL("**/dashboard");
  // A fresh navigation back to /dashboard re-collapses the <details> — every
  // redirect back here needs its own re-expand, not just the first one.
  await openAccountSettings(page, "Two-factor authentication is on.");

  // The actual regression check: log back in via the shared helper, which
  // only completes past a TOTP prompt if one is actually shown.
  await loginAsUser(page, user);
  await expect(page).toHaveURL(/\/dashboard/);

  // And it can be turned back off, since it was never mandatory for this role.
  await openAccountSettings(page);
  await page.getByRole("button", { name: "Disable two-factor authentication" }).click();
  // Same same-URL-redirect re-collapse as above.
  await openAccountSettings(page, "Two-factor authentication is off.");
});

test("an Admin has no way to disable their mandatory MFA from the dashboard", async ({ page }) => {
  const admin = await createTestUser({ username: `e2emfaadminnodisable${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  await openAccountSettings(page, "Two-factor authentication is on.");
  await expect(page.getByRole("button", { name: "Disable two-factor authentication" })).toHaveCount(0);
});

test("a member requests account cancellation, an admin sees and anonymizes it, and the account can no longer log in", async ({
  page,
}) => {
  const member = await createTestUser({ username: `e2ecancelme${Date.now()}` });
  await loginAsUser(page, member);

  await openAccountSettings(page);
  await page.getByLabel("Why are you canceling?").fill("No longer in the area");
  await page.getByRole("button", { name: "Request account cancellation" }).click();
  // requestCancellationAction redirects back to the same /dashboard URL,
  // which re-collapses the <details> on the fresh render — re-expand.
  await openAccountSettings(page, /You requested account cancellation on/);

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

  // Regression check: the status form has no "Deleted" option, so it used
  // to silently default to "Active" and let a plain submit reverse the
  // anonymization. It's replaced entirely by a plain notice now.
  await expect(page.getByText("This account has been anonymized and can't be reactivated.")).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveCount(0);

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

test("a member toggles marketing email opt-in from their dashboard, and an admin can filter/export by it", async ({
  page,
}) => {
  const member = await createTestUser({ username: `e2emarketingtoggle${Date.now()}` });
  await loginAsUser(page, member);

  await openAccountSettings(page);
  await page.getByLabel("Send me occasional email about upcoming events and news").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(async () => {
    const row = await pool.query<{ marketing_email_opt_in: boolean }>(
      `SELECT marketing_email_opt_in FROM users WHERE id = $1`,
      [member.id],
    );
    expect(row.rows[0].marketing_email_opt_in).toBe(true);
  }).toPass({ timeout: 5000 });

  const admin = await createTestUser({ username: `e2emarketingadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  await page.goto("/admin/users");
  await page.getByLabel("Marketing email opt-in").check();
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: member.username })).toBeVisible();
});
