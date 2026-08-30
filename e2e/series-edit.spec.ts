import { expect, test } from "@playwright/test";
import { createTestUser, findOpenSlotBase, loginAsUser, pool, withSlotLock } from "./helpers";
import { bookSeriesSeat } from "@/lib/series/actions";

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("series editing: seat-count guard, add more dates, instance editor", async ({ page }) => {
  test.setTimeout(60_000);

  const admin = await createTestUser({ username: `e2eseriesediteditadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const name = `series-edit-test-${Date.now()}`;
  const now = new Date();
  // DB-checked base offset, same reasoning as series.spec.ts (avoids
  // colliding with leftover sessions from a previous run, or with a
  // genuinely busy migrated/recurring near-term calendar). "Morning" is
  // also used by admin-sessions.spec.ts's own findOpenSlotBase calls —
  // slot-per-file exclusivity ran out of room once enough spec files
  // needed single-date grid-visible sessions (only 3 slots exist).
  // withSlotLock is what actually closes the collision now, not which slot
  // name gets picked — it serializes the search + the actual series creation across
  // every concurrent worker/process targeting "Morning" — the search alone
  // (findOpenSlotBase) can't prevent two workers both picking the same open
  // day before either has committed. day3 is checked as free here too (part
  // of the same offsets array) but not actually reserved until the
  // "add more dates" step below, which gets its own separate lock.
  const day3 = await withSlotLock("Morning", async () => {
    const base = await findOpenSlotBase(now, "Morning", [0, 7, 14], 3, 22);
    const day1 = toDateOnly(new Date(now.getTime() + base * 86400000));
    const day2 = toDateOnly(new Date(now.getTime() + (base + 7) * 86400000));
    const day3 = toDateOnly(new Date(now.getTime() + (base + 14) * 86400000));

    await page.goto("/admin/sessions/new-series");
    await page.getByLabel("Series name").fill(name);
    await page.getByLabel(/^Seat count/).fill("3");
    await page.locator(`input[name="slots"][value="${day1}|Morning"]`).check();
    await page.locator(`input[name="slots"][value="${day2}|Morning"]`).check();
    await page.getByRole("button", { name: "Create series" }).click();
    await page.waitForURL("**/admin/sessions/series");
    return day3;
  });

  const seriesResult = await pool.query<{ id: string }>(`SELECT id FROM series WHERE name = $1`, [name]);
  expect(seriesResult.rowCount).toBe(1);
  const seriesId = seriesResult.rows[0].id;

  let occurrences: { rows: { id: string; start_time: Date }[] } = { rows: [] };
  await expect(async () => {
    occurrences = await pool.query<{ id: string; start_time: Date }>(
      `SELECT id, start_time FROM sessions WHERE series_id = $1 ORDER BY start_time ASC`,
      [seriesId],
    );
    expect(occurrences.rows.length).toBe(2);
  }).toPass({ timeout: 5000 });
  const [session1, session2] = occurrences.rows;

  // Reserve seat 3 on session1 directly (setup, not the thing under test).
  const seatHolder = await createTestUser({ username: `e2eseriesediteditm1${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    seatHolder.id,
  ]);
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    seatHolder.id,
  ]);
  const bookResult = await bookSeriesSeat(seatHolder.id, seriesId, 3, [session1.id]);
  expect(bookResult).toEqual({ ok: true });

  // Reducing seat_count below the highest reserved seat number is rejected.
  await page.goto(`/admin/sessions/series/${seriesId}`);
  await page.getByLabel("Seat count").fill("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Can't reduce seat count below 3/)).toBeVisible();

  // A valid change (increasing) succeeds and updates future sessions' capacity.
  await page.getByLabel("Seat count").fill("4");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(`**/admin/sessions/series/${seriesId}`);

  await expect(async () => {
    const capacities = await pool.query<{ max_capacity: number }>(
      `SELECT max_capacity FROM sessions WHERE series_id = $1 AND status = 'Scheduled'`,
      [seriesId],
    );
    expect(capacities.rows.every((r) => r.max_capacity === 4)).toBe(true);
  }).toPass({ timeout: 5000 });

  // Add more dates to the existing series via the picker's add-dates mode.
  // day3 was checked free back when it was picked, but wasn't actually
  // reserved until now — the same withSlotLock protection applies to this
  // second creation step independently.
  await withSlotLock("Morning", async () => {
    await page.goto(`/admin/sessions/new-series?seriesId=${seriesId}`);
    await expect(page.getByRole("heading", { name: `Add dates to "${name}"` })).toBeVisible();
    await page.locator(`input[name="slots"][value="${day3}|Morning"]`).check();
    await page.getByRole("button", { name: "Add dates to series" }).click();
    await page.waitForURL(`**/admin/sessions/series/${seriesId}`);
  });

  await expect(async () => {
    const afterAdd = await pool.query<{ count: string }>(
      `SELECT count(*) FROM sessions WHERE series_id = $1`,
      [seriesId],
    );
    expect(Number(afterAdd.rows[0].count)).toBe(3);
  }).toPass({ timeout: 5000 });

  // Instance editor: edit session2's own capacity/host in place. The host
  // dropdown only offers SessionManager-tagged users (HostSelect), so this
  // test user needs that role to be selectable at all.
  const editedHost = await createTestUser({ username: `e2eseriesediteditbook${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [editedHost.id]);
  await page.goto(`/admin/sessions/${session2.id}`);
  await page.getByLabel(/^Capacity/).fill("7");
  await page.getByLabel(/^Host$/).selectOption(editedHost.username);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(`**/admin/sessions/${session2.id}`);

  await expect(async () => {
    const session2Row = await pool.query<{ max_capacity: number; host_user_id: string | null }>(
      `SELECT max_capacity, host_user_id FROM sessions WHERE id = $1`,
      [session2.id],
    );
    expect(session2Row.rows[0].max_capacity).toBe(7);
    expect(session2Row.rows[0].host_user_id).toBe(editedHost.id);

    // session1 is untouched by session2's instance edit.
    const session1Row = await pool.query<{ max_capacity: number; host_user_id: string | null }>(
      `SELECT max_capacity, host_user_id FROM sessions WHERE id = $1`,
      [session1.id],
    );
    expect(session1Row.rows[0].max_capacity).toBe(4);
    expect(session1Row.rows[0].host_user_id).toBeNull();
  }).toPass({ timeout: 5000 });

  // A later series-metadata edit bumps session1 (still at the old seat
  // count) to the new one, but does NOT clobber session2's individually
  // overridden capacity back down — regression check for the "series save
  // clobbers instance overrides" bug found in review.
  await page.goto(`/admin/sessions/series/${seriesId}`);
  await page.getByLabel("Seat count").fill("5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(`**/admin/sessions/series/${seriesId}`);

  await expect(async () => {
    const session1Row = await pool.query<{ max_capacity: number }>(
      `SELECT max_capacity FROM sessions WHERE id = $1`,
      [session1.id],
    );
    expect(session1Row.rows[0].max_capacity).toBe(5);

    const session2Row = await pool.query<{ max_capacity: number }>(
      `SELECT max_capacity FROM sessions WHERE id = $1`,
      [session2.id],
    );
    expect(session2Row.rows[0].max_capacity).toBe(7);
  }).toPass({ timeout: 5000 });

  // Instance editor: capacity can't drop below what's already booked.
  // Reserve a second seat on session1 so it has 2 booked passes.
  const seatHolder2 = await createTestUser({ username: `e2eseriesediteditm2${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    seatHolder2.id,
  ]);
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    seatHolder2.id,
  ]);
  const bookResult2 = await bookSeriesSeat(seatHolder2.id, seriesId, 1, [session1.id]);
  expect(bookResult2).toEqual({ ok: true });

  await page.goto(`/admin/sessions/${session1.id}`);
  await page.getByLabel(/^Capacity/).fill("1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Capacity can't be less than the 2 ticket\(s\) already booked/)).toBeVisible();

  // Instance editor: a Canceled session can't be edited — the edit form
  // disappears from the page entirely once canceled (the UI-reachable half
  // of the fix; the server-side "AND status = 'Scheduled'"/status check in
  // updateSessionDetailsAction is the other half, guarding a direct POST
  // that bypasses this UI, which isn't reachable through the browser here).
  await page.getByRole("button", { name: "Cancel this occurrence only" }).click();
  await page.waitForURL(`**/admin/sessions/${session1.id}`);
  await expect(page.getByText(/Status: Canceled/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit this occurrence" })).toHaveCount(0);
});
