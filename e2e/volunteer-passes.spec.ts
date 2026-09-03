import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

const jobTriggerSecret = process.env.JOB_TRIGGER_SECRET!;

test("the job route rejects a request with a missing or wrong secret", async ({ request }) => {
  const noAuth = await request.post("/api/jobs/grant-volunteer-passes");
  expect(noAuth.status()).toBe(401);

  const wrongAuth = await request.post("/api/jobs/grant-volunteer-passes", {
    headers: { authorization: "Bearer not-the-real-secret" },
  });
  expect(wrongAuth.status()).toBe(401);
});

test("the scheduled job grants weekly tickets, the dashboard reflects it, and re-running it doesn't double-grant", async ({
  page,
  request,
}) => {
  const volunteer = await createTestUser({ username: `e2evolunteer${Date.now()}` });
  const admin = await createTestUser({ username: `e2evolunteeradmin${Date.now()}`, baseRole: "Admin" });

  await loginAsUser(page, admin);
  await page.goto(`/admin/users/${volunteer.id}`);
  await page.getByLabel("Assign a role").selectOption({ label: "General Volunteer" });
  await page.getByRole("button", { name: "Assign role" }).click();
  await page.waitForURL(`**/admin/users/${volunteer.id}`);
  await expect(page.getByText("General Volunteer")).toBeVisible();

  // No admin-UI button anymore — this is the actual production trigger
  // (.github/workflows/grant-volunteer-passes.yml calls this same route on a
  // schedule), so the test drives it the same way.
  const first = await request.post("/api/jobs/grant-volunteer-passes", {
    headers: { authorization: `Bearer ${jobTriggerSecret}` },
  });
  expect(first.ok()).toBe(true);
  expect(await first.json()).toMatchObject({ granted: expect.any(Number) });

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

  // The admin-facing "recent grants" listing (replaces the old one-off
  // result banner) should show this grant. Scoped to the "Volunteer weekly
  // tickets" section specifically — the volunteer's newly-granted pass also
  // shows up as its own row in the big all-tickets table further down the
  // same page, so an unscoped row lookup by username matches both.
  await loginAsUser(page, admin);
  await page.goto("/admin/passes");
  const volunteerGrantsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Volunteer weekly tickets" }) });
  await expect(volunteerGrantsSection.getByRole("row", { name: new RegExp(volunteer.username) })).toBeVisible();

  // Re-running the job this same week must not double-grant.
  const countBefore = await pool.query<{ count: string }>(
    `SELECT count(*) FROM passes WHERE owner_id = $1 AND is_volunteer_grant = true`,
    [volunteer.id],
  );
  const second = await request.post("/api/jobs/grant-volunteer-passes", {
    headers: { authorization: `Bearer ${jobTriggerSecret}` },
  });
  expect(second.ok()).toBe(true);
  expect(await second.json()).toMatchObject({ alreadyGranted: expect.any(Number) });
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
