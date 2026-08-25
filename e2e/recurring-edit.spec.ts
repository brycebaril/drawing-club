import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("recurring rule edit: this-date-forward cancels+regenerates, earlier booking untouched", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const admin = await createTestUser({ username: `e2eruleeditadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const description = `rule-edit-test-${Date.now()}`;
  // +5 rather than recurring.spec.ts's +3 — both files' rules run weekly
  // from today, so sharing an offset would put them on the exact same
  // weekday and collide in the schedule grid's one-session-per-cell display.
  const targetDow = (new Date().getDay() + 5) % 7;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 26);

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
  expect(occurrences.rowCount!).toBeGreaterThanOrEqual(4);

  const earlyOccurrence = occurrences.rows[0];
  const editFromOccurrence = occurrences.rows[1];
  const laterOccurrence = occurrences.rows[occurrences.rows.length - 1];

  // Member 1 books the early occurrence (should survive the edit untouched);
  // member 2 books the later one (should get canceled and released).
  const member1 = await createTestUser({ username: `e2eruleeditm1${Date.now()}` });
  const member2 = await createTestUser({ username: `e2eruleeditm2${Date.now()}` });
  for (const member of [member1, member2]) {
    await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
      member.id,
    ]);
    await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
      member.id,
    ]);
  }

  await loginAsUser(page, member1);
  await page.goto(`/app/schedule?session_id=${earlyOccurrence.id}`);
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${earlyOccurrence.id}`);
  await expect(page.getByRole("button", { name: "Cancel registration" })).toBeVisible();

  await loginAsUser(page, member2);
  await page.goto(`/app/schedule?session_id=${laterOccurrence.id}`);
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${laterOccurrence.id}`);
  await expect(page.getByRole("button", { name: "Cancel registration" })).toBeVisible();

  // Admin edits the rule "from this date forward" (anchored at the second
  // occurrence), changing the day of week and time.
  const newDow = (targetDow + 1) % 7;
  await loginAsUser(page, admin);
  await page.goto(`/admin/sessions/recurring/${ruleId}`);
  await page.getByLabel("Day of week").selectOption(String(newDow));
  await page.getByLabel("Start time").fill("19:00");
  await page.getByLabel("End time").fill("21:00");
  await page.getByLabel("From this date forward").check();
  await page.getByLabel("Date", { exact: true }).fill(toDateInput(new Date(editFromOccurrence.start_time)));
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(`**/admin/sessions/recurring/${ruleId}`);

  await expect(async () => {
    const earlyStatus = await pool.query<{ status: string }>(`SELECT status FROM sessions WHERE id = $1`, [
      earlyOccurrence.id,
    ]);
    expect(earlyStatus.rows[0].status).toBe("Scheduled");

    const member1Pass = await pool.query<{ status: string }>(
      `SELECT status FROM passes WHERE owner_id = $1 AND session_id = $2`,
      [member1.id, earlyOccurrence.id],
    );
    expect(member1Pass.rows[0].status).toBe("Used");

    const laterStatus = await pool.query<{ status: string }>(`SELECT status FROM sessions WHERE id = $1`, [
      laterOccurrence.id,
    ]);
    expect(laterStatus.rows[0].status).toBe("Canceled");

    const member2Passes = await pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Available'`,
      [member2.id],
    );
    expect(Number(member2Passes.rows[0].count)).toBe(1);

    // Fresh sessions exist on the new schedule from the edit's anchor date
    // forward — the old (now-Canceled) rows are never deleted, so any
    // Scheduled session in that range must be newly regenerated.
    const regenerated = await pool.query<{ start_time: Date }>(
      `SELECT start_time FROM sessions
       WHERE recurrence_rule_id = $1 AND status = 'Scheduled' AND start_time >= $2
       ORDER BY start_time ASC`,
      [ruleId, editFromOccurrence.start_time],
    );
    expect(regenerated.rowCount!).toBeGreaterThan(0);
    const firstNew = new Date(regenerated.rows[0].start_time);
    expect(firstNew.getDay()).toBe(newDow);
    expect(firstNew.getHours()).toBe(19);
  }).toPass({ timeout: 5000 });
});
