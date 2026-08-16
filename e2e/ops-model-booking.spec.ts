import { expect, test } from "@playwright/test";
import { createOneOffSessionAsAdmin, createTestUser, loginAsUser, pool } from "./helpers";

test("VOL_MBR assigns a model to an unassigned session and notifies the host", async ({ page }) => {
  const modelBooker = await createTestUser({ username: `e2emodelbooker${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ModelBooker')`, [
    modelBooker.id,
  ]);

  const modelName = `E2E Model ${Date.now()}`;
  await pool.query(`INSERT INTO models (name, contact_info) VALUES ($1, $2)`, [
    modelName,
    "model@example.test",
  ]);

  const startTime = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `model-booking-test-${Date.now()}`,
    startTime,
    capacity: 10,
  });
  const host = await createTestUser({ username: `e2emodelbookinghost${Date.now()}` });
  await pool.query(`UPDATE sessions SET host_user_id = $1 WHERE id = $2`, [host.id, sessionId]);

  await loginAsUser(page, modelBooker);
  await page.goto("/ops/model-booking");

  const row = page.locator("tr", { hasText: host.username });
  await expect(row).toBeVisible();
  await row.getByRole("combobox").selectOption({ label: modelName });
  await row.getByPlaceholder("Note for the host (optional)").fill("Please arrive 15 min early.");
  await row.getByRole("button", { name: "Assign & notify host" }).click();

  await expect(async () => {
    const mapping = await pool.query<{ count: string }>(
      `SELECT count(*) FROM session_model_mapping smm JOIN models m ON m.id = smm.model_id
       WHERE smm.session_id = $1 AND m.name = $2`,
      [sessionId, modelName],
    );
    expect(Number(mapping.rows[0].count)).toBe(1);
  }).toPass({ timeout: 5000 });

  const noteRow = await pool.query<{ count: string }>(
    `SELECT count(*) FROM session_notes WHERE session_id = $1 AND content = $2`,
    [sessionId, "Please arrive 15 min early."],
  );
  expect(Number(noteRow.rows[0].count)).toBe(1);

  await page.goto("/ops/model-booking?filter=unassigned");
  await expect(page.getByText(host.username)).toHaveCount(0);
});

test("VOL_MBR can mark a session as not requiring a model", async ({ page }) => {
  const modelBooker = await createTestUser({ username: `e2emodelbookernr${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ModelBooker')`, [
    modelBooker.id,
  ]);

  const startTime = new Date(Date.now() + 74 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `model-not-required-test-${Date.now()}`,
    startTime,
    capacity: 10,
  });
  const host = await createTestUser({ username: `e2emodelnrhost${Date.now()}` });
  await pool.query(`UPDATE sessions SET host_user_id = $1 WHERE id = $2`, [host.id, sessionId]);

  await loginAsUser(page, modelBooker);
  await page.goto("/ops/model-booking");

  const row = page.locator("tr", { hasText: host.username });
  await row.getByRole("button", { name: "No model required" }).click();

  await expect(async () => {
    const session = await pool.query<{ model_required: boolean }>(
      `SELECT model_required FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(session.rows[0].model_required).toBe(false);
  }).toPass({ timeout: 5000 });

  await page.goto("/ops/model-booking?filter=unassigned");
  await expect(page.getByText(host.username)).toHaveCount(0);
});
