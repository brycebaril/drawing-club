import { expect, test } from "@playwright/test";
import { createTestUser, findOpenSlotBase, loginAsUser, pool } from "./helpers";
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

  // The dev DB carries the full re-migrated legacy dataset (CLAUDE.md's
  // "Post-reporting-overhaul" notes), which densely occupies the Evening
  // slot on most near-term days — a fixed +3-days-from-today weekday (the
  // old approach here) can land the rule's weekly occurrences on the same
  // day+slot as a real pre-existing session, and the schedule grid's
  // one-session-per-cell display then shows that other session instead of
  // this test's own occurrence. findOpenSlotBase (already used by
  // series.spec.ts/series-edit.spec.ts for the same reason) picks a base
  // offset (3-9 days out, covering every day-of-week once) whose whole
  // weekly cadence — 4 occurrences, matching the rowCount check below — is
  // genuinely free.
  const base = await findOpenSlotBase(now, "Evening", [0, 7, 14, 21], 3, 9);
  const targetDow = (now.getDay() + base) % 7;

  // Capped to a 4-week end date (rather than a perpetual rule): the full
  // 90-day/~13-occurrence horizon is already covered by dates.test.ts's
  // computeOccurrenceDates unit tests, and this e2e test's own
  // this-and-future cancellation loop does real per-session DB work — a
  // perpetual rule here would mean canceling ~11 occurrences serially and
  // risk the test itself timing out under parallel-worker contention. The
  // +3-day buffer past the 4th occurrence (base+21) leaves room regardless
  // of which base findOpenSlotBase picked.
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + base + 24);

  await page.goto("/admin/sessions/new-recurring");
  await page.getByLabel("Description").fill(description);
  await page.getByLabel("Day of week").selectOption(String(targetDow));
  await page.getByLabel("Start time").fill("18:00");
  await page.getByLabel("End time").fill("20:00");
  await page.getByLabel(/^Capacity/).fill("5");
  await page.getByLabel("Start date").fill(toDateInput(new Date()));
  await page.getByLabel(/^End date/).fill(toDateInput(endDate));
  await page.getByRole("button", { name: "Create recurring session" }).click();
  await page.waitForURL("**/admin/sessions/recurring");

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

  await page.goto("/app/schedule");
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
