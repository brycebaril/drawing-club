import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";
import { toDateOnly } from "@/lib/sessions/shared";

function mostRecentCompletedWeekStart(now: Date): Date {
  const mostRecentSunday = new Date(now);
  mostRecentSunday.setHours(0, 0, 0, 0);
  mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
  const weekStart = new Date(mostRecentSunday);
  weekStart.setDate(weekStart.getDate() - 6);
  return weekStart;
}

test("Controller generates a payout report, downloads its CSV, and regenerating is idempotent", async ({
  page,
}) => {
  const controller = await createTestUser({ username: `e2efinancials${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'Controller')`, [
    controller.id,
  ]);

  const modelName = `E2E Payout Model ${Date.now()}`;
  const modelResult = await pool.query<{ id: string }>(
    `INSERT INTO models (name, contact_info) VALUES ($1, $2) RETURNING id`,
    [modelName, "payout-model@example.test"],
  );
  const modelId = modelResult.rows[0].id;

  const weekStart = mostRecentCompletedWeekStart(new Date());
  const sessionStart = new Date(weekStart);
  sessionStart.setDate(sessionStart.getDate() + 2); // Wednesday of that week
  sessionStart.setHours(18, 0, 0, 0);
  const sessionEnd = new Date(sessionStart.getTime() + 2 * 60 * 60 * 1000);

  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, max_capacity, is_ticketed, status)
     VALUES ('L', $1, $2, 10, true, 'Scheduled') RETURNING id`,
    [sessionStart, sessionEnd],
  );
  await pool.query(`INSERT INTO session_model_mapping (session_id, model_id) VALUES ($1, $2)`, [
    sessionResult.rows[0].id,
    modelId,
  ]);

  await loginAsUser(page, controller);
  await page.goto("/ops/financials");

  const weekStartStr = toDateOnly(weekStart);
  await page.getByLabel("Week start (must be a Monday)").fill(weekStartStr);
  await page.getByRole("button", { name: "Generate this week's report" }).click();

  await expect(async () => {
    const report = await pool.query<{ sessions_worked: number; total_owed: string }>(
      `SELECT sessions_worked, total_owed FROM model_payout_reports
       WHERE model_id = $1 AND week_start_date = $2`,
      [modelId, weekStartStr],
    );
    expect(report.rowCount).toBe(1);
    expect(report.rows[0].sessions_worked).toBe(1);
    expect(report.rows[0].total_owed).toBe("115.00");
  }).toPass({ timeout: 5000 });

  const csvResponse = await page.request.get(`/ops/financials/csv?weekStart=${weekStartStr}`);
  expect(csvResponse.ok()).toBe(true);
  const csvBody = await csvResponse.text();
  expect(csvBody).toContain(modelName);
  expect(csvBody).toContain("115.00");

  // Regenerating the same week must not double the total or duplicate the row.
  await page.goto("/ops/financials");
  await page.getByLabel("Week start (must be a Monday)").fill(weekStartStr);
  await page.getByRole("button", { name: "Generate this week's report" }).click();

  await expect(async () => {
    const reports = await pool.query<{ count: string }>(
      `SELECT count(*) FROM model_payout_reports WHERE model_id = $1 AND week_start_date = $2`,
      [modelId, weekStartStr],
    );
    expect(Number(reports.rows[0].count)).toBe(1);
  }).toPass({ timeout: 5000 });
});

test("a non-Controller hitting /ops/financials itself (not just the payout drill-down) is bounced to the dashboard", async ({
  page,
}) => {
  // The drill-down subpage (/ops/financials/payouts/[id]) already has its
  // own denial test (ops-financials-reconciliation.spec.ts) — the top-level
  // /ops/financials page never had one.
  const host = await createTestUser({ username: `e2efinancialsdenied${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [host.id]);

  await loginAsUser(page, host);
  await page.goto("/ops/financials");
  await expect(page).toHaveURL(/\/dashboard$/);
});
