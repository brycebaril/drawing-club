import { expect, test } from "@playwright/test";
import { createTestUser, findOpenSlotBase, loginAsUser, pool, withSlotLock } from "./helpers";
import { parseDateOnly, SLOT_TIMES, toDateOnly } from "@/lib/sessions/shared";

test("admin creates a one-off session via the calendar grid's quick-add modal, choosing a host from the dropdown", async ({
  page,
}) => {
  const now = new Date();
  const admin = await createTestUser({ username: `e2eadminsessions${Date.now()}`, baseRole: "Admin" });
  const host = await createTestUser({ username: `e2eadminsessionshost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [host.id]);
  await loginAsUser(page, admin);

  const description = `quick-add-test-${Date.now()}`;
  // The search (is day X free?) and the actual creation via this UI form
  // are two separate steps with nothing stopping a concurrent worker from
  // doing the same for the same slot in between — withSlotLock serializes
  // the whole sequence across every process sharing this DB.
  const dateLabel = await withSlotLock("Morning", async () => {
    // GRID_WINDOW_DAYS is 28 (page.tsx) — stay well inside that window so
    // the default (unpaginated) view renders the chosen cell.
    const base = await findOpenSlotBase(now, "Morning", [0], 3, 26);
    const targetDate = parseDateOnly(toDateOnly(new Date(now.getTime() + base * 86400000)));
    const label = targetDate.toLocaleDateString();

    await page.goto("/admin/sessions");
    await page.getByRole("button", { name: `Add a session on ${label} (Morning)` }).click();
    await expect(page.getByRole("dialog", { name: "Add a session" })).toBeVisible();
    await page.getByLabel("Description").fill(description);
    await page.getByLabel("Host").selectOption({ label: host.username });
    await page.getByRole("button", { name: "Create session" }).click();
    await page.waitForURL("**/admin/sessions");
    return label;
  });

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
  const first = `collision-test-a-${Date.now()}`;
  const second = `collision-test-b-${Date.now()}`;
  const dateLabel = await withSlotLock("Afternoon", async () => {
    const base = await findOpenSlotBase(now, "Afternoon", [0], 3, 26);
    const targetDate = parseDateOnly(toDateOnly(new Date(now.getTime() + base * 86400000)));
    const times = SLOT_TIMES.Afternoon;
    const startTime = new Date(`${toDateOnly(targetDate)}T${times.start}`);
    const endTime = new Date(`${toDateOnly(targetDate)}T${times.end}`);

    await pool.query(
      `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
       VALUES ('R', $1, $2, $3, 5, true), ('R', $4, $2, $3, 5, true)`,
      [first, startTime, endTime, second],
    );
    return targetDate.toLocaleDateString();
  });

  const admin = await createTestUser({ username: `e2eadminsessionscollide${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/admin/sessions");

  const cell = page.getByRole("button", { name: new RegExp(`Edit R session on ${dateLabel.replace(/\//g, "\\/")} \\(Afternoon\\)`) });
  await expect(cell).toBeVisible();
  await expect(cell).toContainText("+1");
  await expect(cell).toHaveAccessibleName(/1 more session\(s\) also scheduled in this slot/);
});

test("the All sessions table defaults to current-to-old order and flags a past session's edit link as retroactive", async ({
  page,
}) => {
  // Local/CI dev DBs can carry a lot of real historical + generated future
  // session data (thousands of rows) — a session dated merely "10 days out"
  // isn't guaranteed to land on page 1, so this uses a date far enough in
  // the future that nothing else could plausibly rank ahead of it (no
  // rollforward horizon in this app reaches anywhere near this far), making
  // the "default sort is descending" check robust regardless of how much
  // other data exists.
  const future = `all-sessions-future-${Date.now()}`;
  const futureRow = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', $1, now() + interval '5 years', now() + interval '5 years' + interval '3 hours', 5, true)
     RETURNING id`,
    [future],
  );

  const admin = await createTestUser({ username: `e2eallsessions${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/admin/sessions?sort=start");

  // Descending default: the single most-future session in the whole table
  // (this one) must be the very first data row. Scoped to the "All
  // sessions" table specifically (identified by its "Booked / Capacity"
  // header) — the admin calendar grid above it on the same page is *also*
  // laid out as a <table>, so a bare "table tbody tr" locator matches that
  // one instead. Checked via the row's own "Manage" link target (its
  // description text isn't part of the table's visible output at all).
  const allSessionsTable = page.locator("table").filter({ has: page.getByText("Booked / Capacity") });
  const firstRowManageLink = allSessionsTable.locator("tbody tr").first().getByRole("link", { name: "Manage" });
  await expect(firstRowManageLink).toHaveAttribute("href", `/admin/sessions/${futureRow.rows[0].id}`);

  // Past-session labeling/warning: use real existing historical data
  // (this dev DB already has plenty from the legacy migration) rather than
  // inserting + hunting for a specific page — go straight to its detail
  // page by id.
  const pastSession = await pool.query<{ id: string }>(
    `SELECT id FROM sessions WHERE status = 'Scheduled' AND start_time < now() ORDER BY start_time DESC LIMIT 1`,
  );
  expect(pastSession.rowCount).toBe(1);
  await page.goto(`/admin/sessions/${pastSession.rows[0].id}`);
  await expect(page.getByText("This session already happened")).toBeVisible();

  await page.goto(`/admin/sessions/${futureRow.rows[0].id}`);
  await expect(page.getByText("This session already happened")).toHaveCount(0);
});
