import { expect, test } from "@playwright/test";
import { createTestUser, findOpenWeekday, loginAsUser, pool, withSlotLock } from "./helpers";
import { generateSessionsForRule } from "@/lib/recurrence/generate";

function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("recurring session lifecycle: create, book, cancel this-and-future, idempotent rollforward", async ({
  page,
}) => {
  // Heavier than the other suites' flows: three separate logins (two of them
  // MFA-enrolling Admins), a recurring-rule creation that itself generates
  // ~13 session rows, and several follow-up navigations.
  test.setTimeout(60_000);

  const admin = await createTestUser({ username: `e2erecadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const description = `recurring-test-${Date.now()}`;
  const now = new Date();

  // Self-cleaning any previous run's leftover 'recurring-test-%' rule before
  // searching makes this file idempotent under repeated local reruns without
  // relying on a human remembering to clean up first; safe because this test
  // file only ever runs as a single instance (not `--repeat-each`), so
  // there's no concurrent run of this same test to race against.
  await pool.query(
    `DELETE FROM sessions WHERE recurrence_rule_id IN (SELECT id FROM recurrence_rules WHERE description LIKE 'recurring-test-%')`,
  );
  await pool.query(`DELETE FROM recurrence_rules WHERE description LIKE 'recurring-test-%'`);

  // Uses "Afternoon", not "Evening", specifically to avoid the tightest-
  // contested slot in the dev DB. The re-migrated legacy dataset (CLAUDE.md's
  // "Post-reporting-overhaul" notes) permanently occupies Evening on 5 of 7
  // weekdays (only Sat/Sun open) vs. Afternoon's 1 of 7 (only Sunday) —
  // confirmed directly against the dev DB. That mattered concretely: with
  // Evening, this test's own weekly-cadence search (needing 4 *simultaneous*
  // free dates on one of only 2 open weekdays) kept losing the race to
  // booking.spec.ts's several Evening-locked one-off tests, which — also
  // pushed onto the same 2 open weekdays by the identical legacy occupancy —
  // each permanently claim one more Sat/Sun date under the very shared
  // "Evening" withSlotLock that serializes them, shrinking this test's
  // narrow 2-of-7 pool further before its own turn. Time-of-day here (the
  // actual hour a "recurring session" runs at) isn't part of what this test
  // exercises, so moving off Evening loses nothing and the extra headroom on
  // Afternoon makes exhaustion far less likely even under heavy contention.
  //
  // findOpenWeekday (not findOpenSlotBase — see its own doc comment for why
  // a day-offset search is the wrong tool for a *weekly* recurring rule,
  // whose actual occurrence dates depend only on day-of-week, not on an
  // arbitrary day-count offset from today) searches all 7 real candidate
  // weekdays and returns one whose whole weekly cadence — 4 occurrences,
  // matching the rowCount check below — is genuinely free. withSlotLock
  // serializes the search + the actual rule creation (which is what really
  // reserves those days) across every concurrent worker/process targeting
  // the same "Afternoon" slot — the search alone can't prevent two workers
  // both picking the same open day before either has committed.
  await withSlotLock("Afternoon", async () => {
    const dow = await findOpenWeekday(now, "Afternoon", [0, 7, 14, 21]);

    // Capped to a 4-week end date (rather than a perpetual rule): the full
    // 90-day/~13-occurrence horizon is already covered by dates.test.ts's
    // computeOccurrenceDates unit tests, and this e2e test's own
    // this-and-future cancellation loop does real per-session DB work — a
    // perpetual rule here would mean canceling ~11 occurrences serially and
    // risk the test itself timing out under parallel-worker contention. The
    // fixed +30-day end date comfortably covers the latest possible
    // occurrence (day-of-week delta up to 6, plus the +21 week offset) with
    // buffer to spare, regardless of which weekday findOpenWeekday picked.
    const end = new Date();
    end.setDate(end.getDate() + 30);

    await page.goto("/admin/sessions/new-recurring");
    await page.getByLabel("Description").fill(description);
    await page.getByLabel("Day of week").selectOption(String(dow));
    await page.getByLabel("Start time").fill("14:00");
    await page.getByLabel("End time").fill("16:00");
    await page.getByLabel(/^Capacity/).fill("5");
    await page.getByLabel("Start date").fill(toDateInput(new Date()));
    await page.getByLabel(/^End date/).fill(toDateInput(end));
    await page.getByRole("button", { name: "Create recurring session" }).click();
    await page.waitForURL("**/admin/sessions/recurring");
  });

  const ruleResult = await pool.query<{ id: string }>(
    `SELECT id FROM recurrence_rules WHERE description = $1`,
    [description],
  );
  expect(ruleResult.rowCount).toBe(1);
  const ruleId = ruleResult.rows[0].id;

  const occurrences = await pool.query<{ id: string; start_time: Date }>(
    `SELECT id, start_time FROM sessions WHERE recurrence_rule_id = $1 ORDER BY start_time ASC`,
    [ruleId],
  );
  // Weekly occurrences from today+3 through today+26 — at least 4.
  expect(occurrences.rowCount!).toBeGreaterThanOrEqual(4);

  const earlierOccurrence = occurrences.rows[0];
  const clickedOccurrence = occurrences.rows[2];
  const laterOccurrence = occurrences.rows[occurrences.rows.length - 1];

  // Occurrences appear on the admin sessions list and detail pages.
  await page.goto(`/admin/sessions/${earlierOccurrence.id}`);
  await expect(page.getByText("Recurring occurrence")).toBeVisible();
  await expect(page.getByText(/Status: Scheduled/)).toBeVisible();

  // A member books the clicked (middle) occurrence.
  const member = await createTestUser({ username: `e2erecmember${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    member.id,
  ]);
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    member.id,
  ]);
  await loginAsUser(page, member);

  // The grid pages a week at a time now (Design Philosophy.dc.html §04) —
  // the clicked (middle) occurrence can land well past week 0, so request
  // its own week rather than assuming the default view shows it.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const clickedDayOffset = Math.floor(
    (new Date(clickedOccurrence.start_time).getTime() - todayStart.getTime()) / 86400000,
  );
  await page.goto(`/app/schedule?week=${Math.floor(clickedDayOffset / 7)}`);
  await expect(page.locator(`a[href*="session_id=${clickedOccurrence.id}"]`)).toBeVisible();

  await page.goto(`/app/schedule?session_id=${clickedOccurrence.id}`);
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${clickedOccurrence.id}`);
  await expect(page.getByRole("button", { name: "Cancel registration" })).toBeVisible();

  // Admin cancels "this and all future occurrences" from the clicked one.
  await loginAsUser(page, admin);
  await page.goto(`/admin/sessions/${clickedOccurrence.id}`);
  await expect(page.getByText(member.username)).toBeVisible();
  await page.getByRole("button", { name: "Cancel this and all future occurrences" }).click();
  await page.waitForURL(`**/admin/sessions/${clickedOccurrence.id}`);
  await expect(page.getByText(/Status: Canceled/)).toBeVisible();

  // The clicked and every later occurrence are canceled...
  await page.goto(`/admin/sessions/${laterOccurrence.id}`);
  await expect(page.getByText(/Status: Canceled/)).toBeVisible();

  // ...but the earlier still-upcoming occurrence is untouched.
  await page.goto(`/admin/sessions/${earlierOccurrence.id}`);
  await expect(page.getByText(/Status: Scheduled/)).toBeVisible();

  // The member's booked pass was released back to their wallet.
  await loginAsUser(page, member);
  await page.goto("/app/wallet");
  await expect(page.getByText("Available tickets: 1")).toBeVisible();

  // A second rollforward is a no-op — the rule's end_date now sits before
  // the canceled occurrences, so nothing new gets generated past the cutoff.
  const created = await generateSessionsForRule(ruleId);
  expect(created).toBe(0);
  const recount = await pool.query<{ count: string }>(
    `SELECT count(*) FROM sessions WHERE recurrence_rule_id = $1`,
    [ruleId],
  );
  expect(Number(recount.rows[0].count)).toBe(occurrences.rowCount);
});
