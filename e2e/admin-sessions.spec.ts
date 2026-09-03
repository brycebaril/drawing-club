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
  // page=1 explicitly, since with no page param at all the table now
  // defaults to the page containing "now" (mirrors /app/schedule's own
  // default view) rather than page 1 — this test wants pure sort order,
  // not that separate default-landing-page behavior.
  await page.goto("/admin/sessions?sort=start&page=1");

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

test("the All sessions table's default (no page param) landing is anchored near today, not the extreme edge of the sort order", async ({
  page,
}) => {
  // Deliberately doesn't insert its own competing far-future marker (the
  // "defaults to current-to-old order" test above already owns that
  // pattern for its own assertion) — two independent far-future rows
  // inserted by tests running in the same parallel worker batch would race
  // on which one actually ranks furthest out, breaking whichever test loses
  // that race (this bit us for real while developing this test, even with
  // a "10 years vs. 5 years" offset split meant to avoid it: this test's
  // temporary row still briefly outranked the other test's while both were
  // mid-flight in the same run). Instead, ask the DB directly for whatever
  // its own actual current furthest-future row is, and confirm that one —
  // whoever it belongs to — isn't visible on the default landing page.
  const globalMax = await pool.query<{ id: string }>(
    `SELECT id FROM sessions WHERE status = 'Scheduled' ORDER BY start_time DESC, id ASC LIMIT 1`,
  );
  expect(globalMax.rowCount).toBe(1);

  // Near enough to "now" that it should reliably fall on whatever page the
  // anchor logic lands on — real session slots are hour-blocks (SLOT_TIMES),
  // so an arbitrary +10-minute mark is very unlikely to collide with other
  // scheduled data sitting even closer to "now". This one doesn't compete
  // with anything else for "most future," so no other test can race it.
  const near = `all-sessions-anchor-near-${Date.now()}`;
  const nearRow = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', $1, now() + interval '10 minutes', now() + interval '3 hours 10 minutes', 5, true)
     RETURNING id`,
    [near],
  );

  try {
    const admin = await createTestUser({ username: `e2eallsessionsanchor${Date.now()}`, baseRole: "Admin" });
    await loginAsUser(page, admin);
    // True default landing: no sort or page params at all.
    await page.goto("/admin/sessions");

    const allSessionsTable = page.locator("table").filter({ has: page.getByText("Booked / Capacity") });
    // Whatever the table's actual most-future row is, it isn't visible on
    // this default landing page — confirms we're not sitting at page 1's
    // extreme future edge. (The rollforward horizon is 90 days and the dev
    // DB carries thousands of rows, so the true global max is guaranteed to
    // be many pages away from "today" — this doesn't depend on any test
    // ever having inserted a far-future row at all.)
    await expect(allSessionsTable.locator(`a[href="/admin/sessions/${globalMax.rows[0].id}"]`)).toHaveCount(0);
    // And the near-"now" row is actually visible without paging anywhere —
    // confirms the landing page is anchored near today, not just "not page 1".
    // .first(): this row has no host/model assigned, so its "Open — needs a
    // host", "Needs a model", and "Manage" cells are three separate links all
    // pointing at the same session id — any one of them proves the row is
    // present.
    await expect(allSessionsTable.locator(`a[href="/admin/sessions/${nearRow.rows[0].id}"]`).first()).toBeVisible();
  } finally {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [nearRow.rows[0].id]);
  }
});
