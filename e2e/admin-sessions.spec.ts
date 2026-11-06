import { expect, test } from "@playwright/test";
import { createTestUser, findOpenSlotBase, loginAsUser, pool, withSlotLock } from "./helpers";
import { SLOT_TIMES, startOfDay, addDays } from "@/lib/sessions/shared";
import { combineOrgDateAndTime } from "@/lib/timezone";
import { ORG_TIMEZONE } from "@/lib/org";

// Matches SessionCalendarGrid.tsx's own aria-label formatting exactly —
// plain .toLocaleDateString() with no timeZone option formats in the
// *process's* local timezone (UTC on CI), which can disagree with the
// grid's ORG_TIMEZONE-formatted label and make this test look for a button
// that isn't actually there under that exact string.
function gridDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE });
}

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
    const targetDate = addDays(startOfDay(now), base);
    const label = gridDateLabel(targetDate);

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
    const targetDate = addDays(startOfDay(now), base);
    const times = SLOT_TIMES.Afternoon;
    const startTime = combineOrgDateAndTime(targetDate, times.start);
    const endTime = combineOrgDateAndTime(targetDate, times.end);

    await pool.query(
      `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
       VALUES ('R', $1, $2, $3, 5, true), ('R', $4, $2, $3, 5, true)`,
      [first, startTime, endTime, second],
    );
    return gridDateLabel(targetDate);
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

  // Past-session labeling/warning: previously relied on the dev DB already
  // holding real historical data from the legacy migration — true on a
  // local dev DB, but CI's own DB only ever runs the plain seed script
  // (never the separate legacy-migration script), so this query came back
  // empty there. Insert a controlled past session instead, same pattern as
  // futureRow above.
  const past = `all-sessions-past-${Date.now()}`;
  const pastRow = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', $1, now() - interval '5 years', now() - interval '5 years' + interval '3 hours', 5, true)
     RETURNING id`,
    [past],
  );
  await page.goto(`/admin/sessions/${pastRow.rows[0].id}`);
  await expect(page.getByText("This session already happened")).toBeVisible();

  await page.goto(`/admin/sessions/${futureRow.rows[0].id}`);
  await expect(page.getByText("This session already happened")).toHaveCount(0);
});

test("the All sessions table's default (no page param) landing is anchored near today, not the extreme edge of the sort order", async ({
  page,
}) => {
  // Self-sufficient instead of trusting ambient data volume: the comment
  // this replaced assumed "the dev DB carries thousands of rows... the true
  // global max is guaranteed to be many pages away" — true on a
  // legacy-migrated local dev DB, false on CI's plain `scripts/seed.ts`
  // (real failure: CI's whole near-future dataset fit on page 1, so the
  // "global max isn't visible" assertion found 3 matches instead of 0).
  // Instead of querying for whatever the ambient global max happens to be,
  // insert our own guaranteed-far row AND enough filler rows ahead of it
  // (comfortably over PAGE_SIZE, see src/app/admin/sessions/page.tsx) to
  // force it off the default landing page regardless of how much other
  // data already exists.
  const marker = `all-sessions-anchor-${Date.now()}`;
  const far = `${marker}-far`;
  const farRow = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', $1, now() + interval '100 days', now() + interval '100 days 3 hours', 5, true)
     RETURNING id`,
    [far],
  );
  const fillerIds = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed)
     SELECT 'R', $1, now() + (n || ' days')::interval, now() + (n || ' days')::interval + interval '3 hours', 5, true
     FROM generate_series(1, 60) AS n
     RETURNING id`,
    [`${marker}-filler`],
  );

  // Near enough to "now" that it should reliably fall on whatever page the
  // anchor logic lands on — real session slots are hour-blocks (SLOT_TIMES),
  // so an arbitrary +10-minute mark is very unlikely to collide with other
  // scheduled data sitting even closer to "now".
  const near = `${marker}-near`;
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
    // Our own far-future row isn't visible on this default landing page —
    // confirms we're not sitting at page 1's extreme future edge.
    await expect(allSessionsTable.locator(`a[href="/admin/sessions/${farRow.rows[0].id}"]`)).toHaveCount(0);
    // And the near-"now" row is actually visible without paging anywhere —
    // confirms the landing page is anchored near today, not just "not page 1".
    // .first(): this row has no host/model assigned, so its "Open — needs a
    // host", "Needs a model", and "Manage" cells are three separate links all
    // pointing at the same session id — any one of them proves the row is
    // present.
    await expect(allSessionsTable.locator(`a[href="/admin/sessions/${nearRow.rows[0].id}"]`).first()).toBeVisible();
  } finally {
    await pool.query(`DELETE FROM sessions WHERE id = ANY($1)`, [
      [farRow.rows[0].id, nearRow.rows[0].id, ...fillerIds.rows.map((r) => r.id)],
    ]);
  }
});

test("editing a session's type via the single-session instance editor recomputes model_required", async ({
  page,
}) => {
  // Regression test: updateSessionDetailsAction updated session_type but
  // never touched model_required, so editing a Regular session into a
  // Party (or vice versa) left the flag stuck at whatever it was set to at
  // creation time.
  const startTime = new Date(Date.now() + 80 * 60 * 60 * 1000);
  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, is_ticketed, model_required)
     VALUES ('R', $1, $2, $3, 10, true, true) RETURNING id`,
    [`edit-type-test-${Date.now()}`, startTime, new Date(startTime.getTime() + 3 * 60 * 60 * 1000)],
  );
  const sessionId = sessionResult.rows[0].id;

  const admin = await createTestUser({ username: `e2eedittype${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto(`/admin/sessions/${sessionId}`);

  // No waitForURL after either submit — start URL and redirect target are
  // the same (/admin/sessions/{id}), the exact "resolves immediately
  // without waiting for the mutation to actually commit" trap this
  // codebase has hit and fixed before (cms.spec.ts). Poll the DB directly
  // instead.
  await page.getByLabel("Type").selectOption("Party");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(async () => {
    const row = await pool.query<{ model_required: boolean }>(
      `SELECT model_required FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(row.rows[0].model_required).toBe(false);
  }).toPass({ timeout: 5000 });

  // And back the other way — editing a Party session into a real drawing
  // type must flip model_required back to true, not leave it false. Reload
  // first so the form's own defaultValue reflects the just-saved "Party"
  // state rather than whatever the browser cached from before this edit.
  await page.reload();
  await page.getByLabel("Type").selectOption("R");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(async () => {
    const row = await pool.query<{ model_required: boolean }>(
      `SELECT model_required FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(row.rows[0].model_required).toBe(true);
  }).toPass({ timeout: 5000 });
});
