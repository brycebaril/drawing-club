import { expect, test } from "@playwright/test";
import { createTestUser, findOpenSlotBase, loginAsUser, pool } from "./helpers";
import { parseDateOnly, SLOT_TIMES, toDateOnly } from "@/lib/sessions/shared";

test("admin creates a one-off session via the calendar grid's quick-add modal, choosing a host from the dropdown", async ({
  page,
}) => {
  const now = new Date();
  // GRID_WINDOW_DAYS is 28 (page.tsx) — stay well inside that window so the
  // default (unpaginated) view renders the chosen cell.
  const base = await findOpenSlotBase(now, "Morning", [0], 3, 26);
  const targetDate = parseDateOnly(toDateOnly(new Date(now.getTime() + base * 86400000)));
  const dateLabel = targetDate.toLocaleDateString();

  const admin = await createTestUser({ username: `e2eadminsessions${Date.now()}`, baseRole: "Admin" });
  const host = await createTestUser({ username: `e2eadminsessionshost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [host.id]);

  await loginAsUser(page, admin);
  await page.goto("/admin/sessions");

  await page.getByRole("button", { name: `Add a session on ${dateLabel} (Morning)` }).click();
  await expect(page.getByRole("dialog", { name: "Add a session" })).toBeVisible();

  const description = `quick-add-test-${Date.now()}`;
  await page.getByLabel("Description").fill(description);
  await page.getByLabel("Host").selectOption({ label: host.username });
  await page.getByRole("button", { name: "Create session" }).click();
  await page.waitForURL("**/admin/sessions");

  await expect(async () => {
    const row = await pool.query<{ host_user_id: string; max_capacity: number }>(
      `SELECT host_user_id, max_capacity FROM sessions WHERE description = $1`,
      [description],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].host_user_id).toBe(host.id);
  }).toPass({ timeout: 5000 });

  // The newly created session now fills that cell — the grid shows it as a
  // filled, edit-opening cell rather than the empty "+" one.
  await expect(page.getByRole("button", { name: `Add a session on ${dateLabel} (Morning)` })).toHaveCount(0);
});

test("two sessions landing in the same day+slot cell show a collision indicator instead of silently hiding one", async ({
  page,
}) => {
  const now = new Date();
  const base = await findOpenSlotBase(now, "Afternoon", [0], 3, 26);
  const targetDate = parseDateOnly(toDateOnly(new Date(now.getTime() + base * 86400000)));
  const dateLabel = targetDate.toLocaleDateString();
  const times = SLOT_TIMES.Afternoon;
  const startTime = new Date(`${toDateOnly(targetDate)}T${times.start}`);
  const endTime = new Date(`${toDateOnly(targetDate)}T${times.end}`);

  const first = `collision-test-a-${Date.now()}`;
  const second = `collision-test-b-${Date.now()}`;
  await pool.query(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', $1, $2, $3, 5, true), ('R', $4, $2, $3, 5, true)`,
    [first, startTime, endTime, second],
  );

  const admin = await createTestUser({ username: `e2eadminsessionscollide${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/admin/sessions");

  const cell = page.getByRole("button", { name: new RegExp(`Edit R session on ${dateLabel.replace(/\//g, "\\/")} \\(Afternoon\\)`) });
  await expect(cell).toBeVisible();
  await expect(cell).toContainText("+1");
  await expect(cell).toHaveAccessibleName(/1 more session\(s\) also scheduled in this slot/);
});
