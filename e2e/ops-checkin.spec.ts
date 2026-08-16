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
  await expect(page.getByText(member.username)).toBeVisible();
  await expect(page.getByText("Not yet")).toBeVisible();

  await page.getByRole("button", { name: "Check in" }).click();
  await page.waitForURL(`**/ops/check-in/${sessionId}`);
  await expect(page.getByText("Checked in")).toBeVisible();

  await expect(async () => {
    const row = await pool.query<{ checked_in: boolean }>(
      `SELECT checked_in FROM passes WHERE owner_id = $1 AND session_id = $2`,
      [member.id, sessionId],
    );
    expect(row.rows[0].checked_in).toBe(true);
  }).toPass({ timeout: 5000 });

  await page.getByLabel("Add a note").fill("Great turnout tonight.");
  await page.getByRole("button", { name: "Post note" }).click();
  await page.waitForURL(`**/ops/check-in/${sessionId}`);
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
