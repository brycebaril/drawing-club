import { expect, test } from "@playwright/test";
import { createOneOffSessionAsAdmin, createTestUser, loginAsUser, pool } from "./helpers";

test("an assigned VOL_HOST can check in an attendee and post a note", async ({ page }) => {
  const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `checkin-test-${Date.now()}`,
    startTime,
    capacity: 5,
  });

  const host = await createTestUser({ username: `e2echeckinhost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [host.id]);
  await pool.query(`UPDATE sessions SET host_user_id = $1 WHERE id = $2`, [host.id, sessionId]);

  const member = await createTestUser({ username: `e2echeckinmember${Date.now()}` });
  await pool.query(
    `INSERT INTO passes (owner_id, session_id, status, effective_price) VALUES ($1, $2, 'Used', 0)`,
    [member.id, sessionId],
  );

  await loginAsUser(page, host);
  await page.goto(`/ops/check-in/${sessionId}`);
  const checkbox = page.getByRole("checkbox", { name: new RegExp(member.username) });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await checkbox.check();
  await expect(checkbox).toBeChecked();

  await expect(async () => {
    const row = await pool.query<{ checked_in: boolean }>(
      `SELECT checked_in FROM passes WHERE owner_id = $1 AND session_id = $2`,
      [member.id, sessionId],
    );
    expect(row.rows[0].checked_in).toBe(true);
  }).toPass({ timeout: 5000 });

  await page.getByLabel("Add a note").fill("Great turnout tonight.");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByText("Great turnout tonight.")).toBeVisible();
  await expect(page.getByText(new RegExp(`${host.username} \\(Host\\)`))).toBeVisible();
});

test("a VOL_HOST not assigned to the session is denied", async ({ page }) => {
  const startTime = new Date(Date.now() + 50 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `checkin-denied-test-${Date.now()}`,
    startTime,
    capacity: 5,
  });

  const otherHost = await createTestUser({ username: `e2echeckinotherhost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [
    otherHost.id,
  ]);

  await loginAsUser(page, otherHost);
  const response = await page.goto(`/ops/check-in/${sessionId}`);
  expect(response?.status()).toBe(404);
});

test("a VOL_MBR can check in on any session, unscoped", async ({ page }) => {
  const startTime = new Date(Date.now() + 52 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `checkin-mbr-test-${Date.now()}`,
    startTime,
    capacity: 5,
  });

  const modelBooker = await createTestUser({ username: `e2echeckinmbr${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ModelBooker')`, [
    modelBooker.id,
  ]);

  await loginAsUser(page, modelBooker);
  const response = await page.goto(`/ops/check-in/${sessionId}`);
  expect(response?.status()).not.toBe(404);
  await expect(page.getByText("Studio guidelines")).toBeVisible();
});

test("a first-time attendee is badged, a member is badged, and the overview page lists a host's session", async ({
  page,
}) => {
  const startTime = new Date(Date.now() + 54 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `checkin-badges-test-${Date.now()}`,
    startTime,
    capacity: 5,
  });

  const host = await createTestUser({ username: `e2ebadgehost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [host.id]);
  await pool.query(`UPDATE sessions SET host_user_id = $1 WHERE id = $2`, [host.id, sessionId]);

  const member = await createTestUser({ username: `e2ebadgemember${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '30 days' WHERE id = $1`, [
    member.id,
  ]);
  await pool.query(
    `INSERT INTO passes (owner_id, session_id, status, effective_price) VALUES ($1, $2, 'Used', 0)`,
    [member.id, sessionId],
  );

  await loginAsUser(page, host);
  await page.goto(`/ops/check-in/${sessionId}`);

  const memberRow = page.getByRole("checkbox", { name: new RegExp(member.username) }).locator("..");
  await expect(memberRow.getByTitle("Member")).toBeVisible();
  await expect(memberRow.getByTitle("First-time attendee")).toBeVisible();

  await expect(page.getByText(/0 attending \+ 4 unregistered seats \(5 max\)/)).toBeVisible();

  await page.goto("/ops/check-in");
  // This session is ~54h out, not "today", so its card starts collapsed —
  // the roster is still correctly rendered inside the closed <details>
  // (just not visible), so toBeAttached is the right check here, not
  // toBeVisible.
  await expect(page.getByText(new RegExp(member.username))).toBeAttached();
});

test("check-in shows every model assigned to a session, not just the first", async ({ page }) => {
  // Regression test: getCheckInRoster used to query model names with
  // LIMIT 1, silently dropping any model past the first from view — this
  // pins the fix (string_agg over every session_model_mapping row).
  const startTime = new Date(Date.now() + 56 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `checkin-multimodel-test-${Date.now()}`,
    startTime,
    capacity: 5,
  });

  const host = await createTestUser({ username: `e2emultimodelhost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [host.id]);
  await pool.query(`UPDATE sessions SET host_user_id = $1 WHERE id = $2`, [host.id, sessionId]);

  // Single-token names — a VOL_HOST (unlike ADMIN/VOL_MBR) sees truncated
  // first-name-only model names, and a multi-word name would collapse two
  // distinct models down to an indistinguishable truncated string.
  const modelOneName = `AlphaE2E${Date.now()}`;
  const modelTwoName = `BetaE2E${Date.now()}`;
  const modelOne = await pool.query<{ id: string }>(
    `INSERT INTO models (name, contact_info) VALUES ($1, 'a@example.test') RETURNING id`,
    [modelOneName],
  );
  const modelTwo = await pool.query<{ id: string }>(
    `INSERT INTO models (name, contact_info) VALUES ($1, 'b@example.test') RETURNING id`,
    [modelTwoName],
  );
  await pool.query(`INSERT INTO session_model_mapping (session_id, model_id) VALUES ($1, $2), ($1, $3)`, [
    sessionId,
    modelOne.rows[0].id,
    modelTwo.rows[0].id,
  ]);

  await loginAsUser(page, host);
  await page.goto(`/ops/check-in/${sessionId}`);
  await expect(page.getByText(new RegExp(`Model: ${modelOneName}, ${modelTwoName}`))).toBeVisible();
});
