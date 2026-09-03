import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("assigning General Volunteer, granting weekly passes, and the dashboard reflecting it", async ({ page }) => {
  const volunteer = await createTestUser({ username: `e2evolunteer${Date.now()}` });
  const admin = await createTestUser({ username: `e2evolunteeradmin${Date.now()}`, baseRole: "Admin" });

  await loginAsUser(page, admin);
  await page.goto(`/admin/users/${volunteer.id}`);
  await page.getByLabel("Assign a role").selectOption({ label: "General Volunteer" });
  await page.getByRole("button", { name: "Assign role" }).click();
  await page.waitForURL(`**/admin/users/${volunteer.id}`);
  await expect(page.getByText("General Volunteer")).toBeVisible();

  await page.goto("/admin/passes");
  await page.getByRole("button", { name: "Grant this week's volunteer tickets" }).click();
  await expect(page.getByText(/volunteer\(s\) granted/)).toBeVisible();

  await expect(async () => {
    const row = await pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Available' AND is_volunteer_grant = true`,
      [volunteer.id],
    );
    expect(Number(row.rows[0].count)).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 5000 });

  await loginAsUser(page, volunteer);
  await expect(page.getByText("Volunteer benefits")).toBeVisible();
  await expect(page.getByText(/You currently hold \d+ of your \d+-ticket cap\./)).toBeVisible();

  // Re-running the grant this same week must not double-grant.
  await loginAsUser(page, admin);
  await page.goto("/admin/passes");
  const countBefore = await pool.query<{ count: string }>(
    `SELECT count(*) FROM passes WHERE owner_id = $1 AND is_volunteer_grant = true`,
    [volunteer.id],
  );
  await page.getByRole("button", { name: "Grant this week's volunteer tickets" }).click();
  await expect(page.getByText(/already granted this week/)).toBeVisible();
  const countAfter = await pool.query<{ count: string }>(
    `SELECT count(*) FROM passes WHERE owner_id = $1 AND is_volunteer_grant = true`,
    [volunteer.id],
  );
  expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
});

test("a plain member with no General Volunteer role sees no Volunteer benefits section", async ({ page }) => {
  const member = await createTestUser({ username: `e2enovolunteer${Date.now()}` });
  await loginAsUser(page, member);
  await expect(page.getByText("Volunteer benefits")).toHaveCount(0);
});
