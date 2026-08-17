import { expect, test } from "@playwright/test";
import { createOneOffSessionAsAdmin, createTestUser, loginAsUser, pool } from "./helpers";

test("banning a user releases their upcoming bookings, notifies the waitlist, and blocks login", async ({
  page,
}) => {
  const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `admin-ban-test-${Date.now()}`,
    startTime,
    capacity: 1,
  });

  const target = await createTestUser({ username: `e2etarget${Date.now()}` });
  await loginAsUser(page, target);
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`,
    [target.id],
  );
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Book (uses 1 pass)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);

  const waiter = await createTestUser({ username: `e2ewaiter${Date.now()}` });
  await loginAsUser(page, waiter);
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);

  const manager = await createTestUser({
    username: `e2emanager${Date.now()}`,
    baseRole: "Admin",
  });
  await loginAsUser(page, manager);
  await page.goto(`/admin/users/${target.id}`);
  await page.getByLabel("Status").selectOption("Banned");
  await page.locator("#status-reason").fill("Repeated no-shows");
  await page.getByRole("button", { name: "Update status" }).click();
  await page.waitForURL(`**/admin/users/${target.id}`);

  await expect(async () => {
    const passRow = await pool.query<{ status: string; session_id: string | null }>(
      `SELECT status, session_id FROM passes WHERE owner_id = $1 ORDER BY id DESC LIMIT 1`,
      [target.id],
    );
    expect(passRow.rows[0]).toMatchObject({ status: "Available", session_id: null });

    const waitlistRow = await pool.query<{ notified_at: Date | null }>(
      `SELECT notified_at FROM waitlist_entries WHERE session_id = $1 AND user_id = $2`,
      [sessionId, waiter.id],
    );
    expect(waitlistRow.rows[0].notified_at).not.toBeNull();
  }).toPass({ timeout: 5000 });

  // Banned account can no longer log in at all.
  await page.context().clearCookies();
  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(target.username);
  await page.getByLabel("Password").fill(target.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(page.url()).toContain("/auth/login");

  // The login-denial check above cleared cookies, logging the manager out
  // too — log back in to view the audit log.
  await loginAsUser(page, manager);

  // Scoped to a row naming this test's own target — the audit log
  // accumulates across repeated local runs, so a bare text match isn't
  // unique enough.
  await page.goto("/admin/audit-logs");
  await expect(
    page.getByRole("row").filter({ hasText: target.username }).filter({ hasText: "ACCOUNT_STATUS_CHANGED" }),
  ).toHaveCount(1);
});

test("granting passes increases the target user's balance and is audit-logged", async ({ page }) => {
  const admin = await createTestUser({ username: `e2eadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const target = await createTestUser({ username: `e2egrantee${Date.now()}` });

  await page.goto(`/admin/users/${target.id}`);
  await page.getByLabel("Quantity").fill("2");
  await page.locator("#grant-reason").fill("Volunteer reward");
  await page.getByRole("button", { name: "Grant passes" }).click();
  await page.waitForURL(`**/admin/users/${target.id}`);

  await expect(page.getByText("Available passes: 2")).toBeVisible();

  await page.goto("/admin/audit-logs");
  await expect(
    page.getByRole("row").filter({ hasText: target.username }).filter({ hasText: "PASS_GRANTED" }),
  ).toHaveCount(1);
});

test("assigning and removing a volunteer role updates the user and is audit-logged", async ({
  page,
}) => {
  const admin = await createTestUser({ username: `e2eadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const target = await createTestUser({ username: `e2evolunteer${Date.now()}` });

  await page.goto(`/admin/users/${target.id}`);
  await page.getByLabel("Assign a role").selectOption("SessionManager");
  await page.getByRole("button", { name: "Assign role" }).click();
  await page.waitForURL(`**/admin/users/${target.id}`);
  await expect(page.getByText("Session Manager (VOL_HOST)")).toBeVisible();

  await page.getByRole("button", { name: "Remove" }).click();
  await page.waitForURL(`**/admin/users/${target.id}`);
  await expect(page.getByText("Session Manager (VOL_HOST)")).not.toBeVisible();

  await page.goto("/admin/audit-logs");
  await expect(
    page.getByRole("row").filter({ hasText: target.username }).filter({ hasText: "VOLUNTEER_ROLE_ASSIGNED" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("row").filter({ hasText: target.username }).filter({ hasText: "VOLUNTEER_ROLE_REMOVED" }),
  ).toHaveCount(1);
});

test("the users list page renders a volunteer's roles without crashing", async ({ page }) => {
  // Regression test: array_agg(vr.role) without a ::text cast returns the
  // raw wire-format string from node-pg for a custom-enum column instead of
  // a parsed JS array — .map() on that string throws. No prior e2e spec
  // ever navigated to /admin/users itself (only /admin/users/[id]), which
  // is exactly why this went undetected until a real admin hit it manually.
  const admin = await createTestUser({ username: `e2eadminlist${Date.now()}`, baseRole: "Admin" });
  const volunteer = await createTestUser({ username: `e2elistvol${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [
    volunteer.id,
  ]);

  await loginAsUser(page, admin);
  await page.goto("/admin/users");

  const row = page.locator("tr", { hasText: volunteer.username });
  await expect(row).toBeVisible();
  await expect(row.getByText("VOL_HOST")).toBeVisible();
});
