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
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  // waitForURL alone resolves instantly (redirect lands on the same
  // session_id URL already loaded) without proving the booking committed —
  // the next line's loginAsUser navigates to about:blank immediately after,
  // which cancels a still-in-flight request from this page. Caught live in
  // booking.spec.ts (see its comments) as an intermittent "session not
  // actually full yet" failure with no code-level cause. Poll for the real
  // DB effect first.
  await expect(async () => {
    const passRow = await pool.query<{ status: string }>(
      `SELECT status FROM passes WHERE owner_id = $1 AND session_id = $2 AND status = 'Used'`,
      [target.id, sessionId],
    );
    expect(passRow.rowCount).toBe(1);
  }).toPass({ timeout: 5000 });

  const waiter = await createTestUser({ username: `e2ewaiter${Date.now()}` });
  await loginAsUser(page, waiter);
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  // Same reasoning as above, for the join-waitlist step.
  await expect(async () => {
    const waitlistRow = await pool.query(`SELECT id FROM waitlist_entries WHERE session_id = $1 AND user_id = $2`, [
      sessionId,
      waiter.id,
    ]);
    expect(waitlistRow.rowCount).toBe(1);
  }).toPass({ timeout: 5000 });

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
  await page.getByRole("button", { name: "Grant tickets" }).click();
  await page.waitForURL(`**/admin/users/${target.id}`);

  await expect(page.getByText("Available tickets: 2")).toBeVisible();

  await page.goto("/admin/audit-logs");
  await expect(
    page.getByRole("row").filter({ hasText: target.username }).filter({ hasText: "PASS_GRANTED" }),
  ).toHaveCount(1);
});

test("an admin can revoke one of a member's own standard (non-transferable) tickets", async ({ page }) => {
  // revokePassAction (src/app/admin/passes/actions.ts) only ever touches
  // is_transferable = true passes and is only reachable from the global
  // /admin/passes table — a standard ticket, which is what most members
  // actually hold, was never revocable anywhere before revokeUserPassAction.
  const admin = await createTestUser({ username: `e2eadminrevoke${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const target = await createTestUser({ username: `e2erevokee${Date.now()}` });
  const passResult = await pool.query<{ id: string }>(
    `INSERT INTO passes (owner_id, status, is_transferable, effective_price) VALUES ($1, 'Available', false, 25) RETURNING id`,
    [target.id],
  );
  const passId = passResult.rows[0].id;

  await page.goto(`/admin/users/${target.id}`);
  await expect(page.getByText("Available tickets: 1")).toBeVisible();

  const row = page.locator("tr", { has: page.locator(`button:has-text("Revoke")`) }).first();
  await row.getByRole("button", { name: "Revoke" }).click();
  await row.getByLabel("Reason").fill("Issued in error");
  await row.getByRole("button", { name: "Confirm revoke" }).click();
  await page.waitForURL(`**/admin/users/${target.id}`);

  await expect(page.getByText("Available tickets: 0")).toBeVisible();

  await expect(async () => {
    const pass = await pool.query<{ status: string }>(`SELECT status FROM passes WHERE id = $1`, [passId]);
    expect(pass.rows[0].status).toBe("Revoked");
  }).toPass({ timeout: 5000 });

  await page.goto("/admin/audit-logs");
  await expect(
    page.getByRole("row").filter({ hasText: target.username }).filter({ hasText: "PASS_REVOKED" }),
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

test("the users list CSV export reflects the current filters", async ({ page }) => {
  const admin = await createTestUser({ username: `e2eadmincsv${Date.now()}`, baseRole: "Admin" });
  const volunteer = await createTestUser({ username: `e2ecsvvol${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ModelBooker')`, [
    volunteer.id,
  ]);
  const other = await createTestUser({ username: `e2ecsvother${Date.now()}` });

  await loginAsUser(page, admin);

  const unfiltered = await page.request.get("/admin/users/csv");
  expect(unfiltered.ok()).toBe(true);
  const unfilteredBody = await unfiltered.text();
  expect(unfilteredBody).toContain(volunteer.username);
  expect(unfilteredBody).toContain("VOL_MBR");
  expect(unfilteredBody).toContain(other.username);

  const filtered = await page.request.get("/admin/users/csv?role=VOL_MBR");
  const filteredBody = await filtered.text();
  expect(filteredBody).toContain(volunteer.username);
  expect(filteredBody).not.toContain(other.username);
});

test("the search field narrows the users list by display name or email, not username", async ({ page }) => {
  const admin = await createTestUser({ username: `e2eadminsearch${Date.now()}`, baseRole: "Admin" });
  const target = await createTestUser({ username: `e2esearchtarget${Date.now()}` });
  // Explicitly overridden so it doesn't embed the username the way
  // createTestUser's default `${username}@example.test` would — otherwise a
  // search for the username would incidentally match via email too, and the
  // "username itself isn't matched" assertion below couldn't tell the
  // difference.
  await pool.query(`UPDATE users SET display_name = 'Zelda Fitzgerald', email = $1 WHERE id = $2`, [
    `zelda-search-${Date.now()}@example.test`,
    target.id,
  ]);
  const other = await createTestUser({ username: `e2esearchother${Date.now()}` });

  await loginAsUser(page, admin);
  await page.goto("/admin/users");

  // Matches by display name.
  await page.getByLabel("Search (display name or email)").fill("zelda");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator("tr", { hasText: target.username })).toBeVisible();
  await expect(page.locator("tr", { hasText: other.username })).toHaveCount(0);

  // Matches by email, case-insensitively.
  await page.getByLabel("Search (display name or email)").fill(other.username.toUpperCase());
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator("tr", { hasText: other.username })).toBeVisible();
  await expect(page.locator("tr", { hasText: target.username })).toHaveCount(0);

  // Username itself isn't matched — target's own username no longer appears
  // in its (overridden) display name or email, so searching it finds nothing.
  await page.getByLabel("Search (display name or email)").fill(target.username);
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator("tr", { hasText: target.username })).toHaveCount(0);

  const csv = await page.request.get(`/admin/users/csv?q=${encodeURIComponent("zelda")}`);
  const csvBody = await csv.text();
  expect(csvBody).toContain(target.username);
  expect(csvBody).not.toContain(other.username);
});

test("the Username column header sorts the list, ascending by default and flipping on a second click", async ({
  page,
}) => {
  const admin = await createTestUser({ username: `e2eadminsort${Date.now()}`, baseRole: "Admin" });
  // "A"/"Z" right after the shared prefix guarantees string-order regardless
  // of the timestamp/entropy suffix createTestUser appends.
  const marker = `SortableColTest${Date.now()}`;
  const userA = await createTestUser({ username: `e2esortA${Date.now()}` });
  const userZ = await createTestUser({ username: `e2esortZ${Date.now()}` });
  await pool.query(`UPDATE users SET display_name = $1 WHERE id = ANY($2::uuid[])`, [
    marker,
    [userA.id, userZ.id],
  ]);

  await loginAsUser(page, admin);
  await page.goto(`/admin/users?q=${encodeURIComponent(marker)}`);

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  // Default sort is username ascending — SQL-level ORDER BY happens before
  // the JS-side search filter (src/lib/users/filterUsers.ts), so relative
  // order survives the filter intact.
  await expect(rows.nth(0)).toContainText(userA.username);
  await expect(rows.nth(1)).toContainText(userZ.username);

  await page.getByRole("link", { name: /^Username/ }).click();
  await expect(page).toHaveURL(/sort=username&dir=desc/);
  const rowsAfterSort = page.locator("tbody tr");
  await expect(rowsAfterSort).toHaveCount(2);
  await expect(rowsAfterSort.nth(0)).toContainText(userZ.username);
  await expect(rowsAfterSort.nth(1)).toContainText(userA.username);
});
