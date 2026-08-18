import { expect, test } from "@playwright/test";
import { pool } from "./helpers";

test("the pricing page reflects the current system_settings values, live", async ({ page }) => {
  const before = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'PRICE_SINGLE_PASS_STANDARD'`,
  );
  const originalValue = before.rows[0].value;

  await page.goto("/pricing");
  await expect(page.getByText(`$${Number(originalValue).toFixed(2)}`).first()).toBeVisible();

  // Same source resolvePrice() reads at checkout — proves this page can't
  // drift the way a hand-typed Markdown price table could.
  const newValue = (Number(originalValue) + 3).toFixed(2);
  try {
    await pool.query(`UPDATE system_settings SET value = $1 WHERE key = 'PRICE_SINGLE_PASS_STANDARD'`, [
      newValue,
    ]);

    await page.goto("/pricing");
    await expect(page.getByText(`$${newValue}`).first()).toBeVisible();
  } finally {
    await pool.query(`UPDATE system_settings SET value = $1 WHERE key = 'PRICE_SINGLE_PASS_STANDARD'`, [
      originalValue,
    ]);
  }
});

test("the 10-pack is labeled members-only, matching the checkout-side restriction", async ({ page }) => {
  await page.goto("/pricing");
  const row = page.locator("tr", { hasText: "10-pack" });
  await expect(row.getByRole("cell", { name: "Members only" })).toBeVisible();
});
