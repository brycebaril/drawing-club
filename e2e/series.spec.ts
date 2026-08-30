import { expect, test } from "@playwright/test";
import { createTestUser, findOpenSlotBase, loginAsUser, pool, withSlotLock } from "./helpers";
import { bookSeriesSeat } from "@/lib/series/actions";

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("multi-week series lifecycle: create, partial-date seat booking, seat contention, this-and-future cancel", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const admin = await createTestUser({ username: `e2eseriesadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const name = `series-test-${Date.now()}`;
  const now = new Date();
  // A DB-checked base offset (rather than a fixed +7 days, or plain
  // randomization) so repeated runs against a non-reset local DB don't
  // collide with a previous run's leftover sessions — or, once the dev DB
  // holds real migrated/recurring data, with a genuinely busy near-term
  // calendar — on the exact same calendar dates. The admin picker shows an
  // already-occupied slot as a disabled "Booked" label with no checkbox,
  // which would make this test flaky without checking first. Kept small
  // enough (day1 stays <= 13 days out) that
  // it's always comfortably inside an Account Holder's 14-day booking
  // window — the member2-vs-member1 seat conflict check below deliberately
  // runs before member2 has a membership, so day1 must never trip the
  // window check first and mask the seat-conflict one it's meant to test.
  // maxBase widened from 10 to 13 after the full re-migrated legacy dataset
  // turned out to solidly occupy the Afternoon slot for the first ~10 days
  // out (confirmed directly against the dev DB) — every base in 3..10
  // collided on at least one of its three far-apart candidate dates, every
  // time, not just occasionally.
  // Afternoon is also used by admin-sessions.spec.ts's own findOpenSlotBase
  // calls — slot-per-file exclusivity ran out of room once enough spec
  // files needed single-date grid-visible sessions (only 3 slots exist).
  // withSlotLock is what actually closes the collision now, not which slot
  // name gets picked: it serializes the search + the real reservation (this
  // series's creation) across every concurrent worker/process targeting
  // "Afternoon", so two workers can no longer both see the same day as free
  // before either has committed.
  await withSlotLock("Afternoon", async () => {
    const base = await findOpenSlotBase(now, "Afternoon", [0, 7, 21], 3, 13);
    // Non-consecutive: base and base+7 days, then skip a week and pick base+21.
    const day1 = toDateOnly(new Date(now.getTime() + base * 86400000));
    const day2 = toDateOnly(new Date(now.getTime() + (base + 7) * 86400000));
    const day3 = toDateOnly(new Date(now.getTime() + (base + 21) * 86400000));

    await page.goto("/admin/sessions/new-series");
    await page.getByLabel("Series name").fill(name);
    await page.getByLabel(/^Seat count/).fill("2");
    await page.locator(`input[name="slots"][value="${day1}|Afternoon"]`).check();
    await page.locator(`input[name="slots"][value="${day2}|Afternoon"]`).check();
    await page.locator(`input[name="slots"][value="${day3}|Afternoon"]`).check();
    await page.getByRole("button", { name: "Create series" }).click();
    await page.waitForURL("**/admin/sessions/series");
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
    expect(occurrences.rows.length).toBe(3);
  }).toPass({ timeout: 5000 });
  const [session1, session2, _session3] = occurrences.rows;

  // Member 1 books seat 1 for the first two dates, leaving the third open.
  // Granted a membership so the 30-day member booking window comfortably
  // covers the +14-day date — an Account Holder's 14-day window would be a
  // flaky exact-boundary case depending on time-of-day the test runs.
  const member1 = await createTestUser({ username: `e2eseriesm1${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    member1.id,
  ]);
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0), ($1, 'Available', 0)`,
    [member1.id],
  );
  await loginAsUser(page, member1);

  await page.goto(`/app/schedule?session_id=${session1.id}`);
  await expect(page.getByText("Seat 1")).toBeVisible();

  await page.goto(`/app/schedule?session_id=${session1.id}&seat=1`);
  await page.locator(`input[name="sessionIds"][value="${session1.id}"]`).check();
  await page.locator(`input[name="sessionIds"][value="${session2.id}"]`).check();
  await page.getByRole("button", { name: "Reserve checked dates (1 ticket each)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${session1.id}&seat=1`);

  // The redirect confirms the server action has run, but this test's own
  // pool connection can briefly lag behind that commit becoming visible
  // (same eventually-consistent-read race booking.spec.ts's waitlist test
  // works around) — poll rather than a one-shot read.
  await expect(async () => {
    const member1Reservations = await pool.query<{ session_id: string }>(
      `SELECT session_id FROM seat_reservations WHERE user_id = $1 AND seat_number = 1 ORDER BY session_id`,
      [member1.id],
    );
    expect(member1Reservations.rowCount).toBe(2);

    const member1UsedPasses = await pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Used'`,
      [member1.id],
    );
    expect(Number(member1UsedPasses.rows[0].count)).toBe(2);
  }).toPass({ timeout: 5000 });

  // Member 2 can't take the same seat/date member 1 already holds...
  const member2 = await createTestUser({ username: `e2eseriesm2${Date.now()}` });
  const conflictResult = await bookSeriesSeat(member2.id, seriesId, 1, [session1.id]);
  expect(conflictResult).toEqual({ ok: false, reason: "seat-taken" });

  // ...but a different seat on that same date succeeds.
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    member2.id,
  ]);
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    member2.id,
  ]);
  await loginAsUser(page, member2);
  await page.goto(`/app/schedule?session_id=${session1.id}&seat=2`);
  await page.locator(`input[name="sessionIds"][value="${session1.id}"]`).check();
  await page.getByRole("button", { name: "Reserve checked dates (1 ticket each)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${session1.id}&seat=2`);

  await expect(async () => {
    const member2Reservation = await pool.query<{ session_id: string }>(
      `SELECT session_id FROM seat_reservations WHERE user_id = $1 AND seat_number = 2`,
      [member2.id],
    );
    expect(member2Reservation.rows.map((r) => r.session_id)).toEqual([session1.id]);
  }).toPass({ timeout: 5000 });

  // Admin cancels "this and future" from the middle date.
  await loginAsUser(page, admin);
  await page.goto(`/admin/sessions/${session2.id}`);
  await page.getByRole("button", { name: "Cancel this and all future occurrences" }).click();
  await page.waitForURL(`**/admin/sessions/${session2.id}`);
  await expect(page.getByText(/Status: Canceled/)).toBeVisible();

  await expect(async () => {
    const statuses = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM sessions WHERE series_id = $1 ORDER BY start_time ASC`,
      [seriesId],
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(["Scheduled", "Canceled", "Canceled"]);

    // The earlier date's reservations (both seats) are untouched...
    const survivingReservations = await pool.query<{ user_id: string; seat_number: number }>(
      `SELECT user_id, seat_number FROM seat_reservations WHERE session_id = $1 ORDER BY seat_number`,
      [session1.id],
    );
    expect(survivingReservations.rows).toEqual([
      { user_id: member1.id, seat_number: 1 },
      { user_id: member2.id, seat_number: 2 },
    ]);

    // ...but the canceled later date's seat reservation is gone and member 1's
    // pass for it is back in their wallet.
    const canceledReservations = await pool.query<{ count: string }>(
      `SELECT count(*) FROM seat_reservations WHERE session_id = $1`,
      [session2.id],
    );
    expect(Number(canceledReservations.rows[0].count)).toBe(0);

    const member1AvailablePasses = await pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Available'`,
      [member1.id],
    );
    expect(Number(member1AvailablePasses.rows[0].count)).toBe(1);
  }).toPass({ timeout: 5000 });
});
