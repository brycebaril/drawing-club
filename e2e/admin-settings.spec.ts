import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("Admin edits an Integer setting and the change is audit-logged", async ({ page }) => {
  const admin = await createTestUser({ username: `e2esettingsint${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const before = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'SESSION_DEFAULT_CAPACITY'`,
  );
  const oldValue = before.rows[0].value;
  const newValue = String(Number(oldValue) + 1);

  await page.goto("/admin/settings");
  const field = page.locator("#value-SESSION_DEFAULT_CAPACITY");
  const form = page.locator("form", { has: field });
  await field.fill(newValue);
  await form.getByRole("button", { name: "Save" }).click();

  // updateSettingAction redirects back to the same URL it started from —
  // waitForURL would resolve trivially without waiting for the save to
  // commit, same trap this app already hit in the CMS/dashboard phases.
  // Poll the DB directly instead.
  await expect(async () => {
    const row = await pool.query<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'SESSION_DEFAULT_CAPACITY'`,
    );
    expect(row.rows[0].value).toBe(newValue);
  }).toPass({ timeout: 5000 });

  const auditRow = await pool.query<{ metadata: { key: string; oldValue: string; newValue: string } }>(
    `SELECT metadata FROM system_audit_logs
     WHERE action_type = 'SETTING_UPDATED' AND actor_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [admin.id],
  );
  expect(auditRow.rows[0].metadata).toEqual({
    key: "SESSION_DEFAULT_CAPACITY",
    oldValue,
    newValue,
  });

  // Restore, so this test doesn't shift shared seeded state for any other
  // test/run relying on the default capacity.
  await pool.query(`UPDATE system_settings SET value = $1 WHERE key = 'SESSION_DEFAULT_CAPACITY'`, [oldValue]);
});

test("editing a Decimal setting with a non-numeric value is rejected", async ({ page }) => {
  const admin = await createTestUser({ username: `e2esettingsdec${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const before = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'PRICE_SINGLE_PASS_STANDARD'`,
  );
  const oldValue = before.rows[0].value;

  await page.goto("/admin/settings");
  const field = page.locator("#value-PRICE_SINGLE_PASS_STANDARD");
  const form = page.locator("form", { has: field });
  await field.fill("free");
  await form.getByRole("button", { name: "Save" }).click();

  await expect(form.getByRole("alert")).toBeVisible();

  const after = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'PRICE_SINGLE_PASS_STANDARD'`,
  );
  expect(after.rows[0].value).toBe(oldValue);
});

test("a non-Admin hitting /admin/settings is redirected, not shown the page", async ({ page }) => {
  const member = await createTestUser({ username: `e2esettingsdenied${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/dashboard$/);
});
