import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

/** Formats a Date as the local-time string a datetime-local input expects. */
function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function createOneOffSessionAsAdmin(
  page: import("@playwright/test").Page,
  opts: { description: string; startTime: Date; capacity: number },
) {
  const admin = await createTestUser({ username: `e2eadmin${Date.now()}${Math.random()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const endTime = new Date(opts.startTime.getTime() + 3 * 60 * 60 * 1000);
  await page.goto("/admin/sessions/new");
  await page.getByLabel("Description").fill(opts.description);
  await page.getByLabel("Start time").fill(toDatetimeLocal(opts.startTime));
  await page.getByLabel("End time").fill(toDatetimeLocal(endTime));
  await page.getByLabel("Capacity").fill(String(opts.capacity));
  await page.getByRole("button", { name: "Create session" }).click();
  await page.waitForURL("**/admin/sessions");

  const result = await pool.query<{ id: string }>(
    `SELECT id FROM sessions WHERE description = $1 ORDER BY start_time DESC LIMIT 1`,
    [opts.description],
  );
  return result.rows[0].id;
}

test.afterAll(() => pool.end());

test("a member books a session, cancels it, and the pass returns to their balance", async ({
  page,
}) => {
  // 2 days out: clear of the 24h cancellation cutoff, well within any window.
  const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `booking-test-${Date.now()}`,
    startTime,
    capacity: 2,
  });

  const member = await createTestUser({ username: `e2emember${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/app/wallet");
  await expect(page.getByText("Available passes: 0")).toBeVisible();
  await page.getByRole("button", { name: "Get a test pass" }).click();
  await page.waitForURL("**/app/wallet");
  await expect(page.getByText("Available passes: 1")).toBeVisible();

  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Book (uses 1 pass)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Cancel registration" })).toBeVisible();

  await page.goto("/app/wallet");
  await expect(page.getByText("Available passes: 0")).toBeVisible();

  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Cancel registration" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Book (uses 1 pass)" })).toBeVisible();

  await page.goto("/app/wallet");
  await expect(page.getByText("Available passes: 1")).toBeVisible();
});

test("waitlisting: a second user is notified after the booked user cancels a full session", async ({
  page,
}) => {
  const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `waitlist-test-${Date.now()}`,
    startTime,
    capacity: 1,
  });

  const first = await createTestUser({ username: `e2efirst${Date.now()}` });
  await loginAsUser(page, first);
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`,
    [first.id],
  );
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Book (uses 1 pass)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);

  const second = await createTestUser({ username: `e2esecond${Date.now()}` });
  await loginAsUser(page, second);
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Join waitlist" })).toBeVisible();
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);
  await expect(page.getByText(/on the waitlist/)).toBeVisible();

  // First user cancels, freeing the only spot.
  await loginAsUser(page, first);
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Cancel registration" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);

  // The redirect after cancellation confirms the server action (including
  // the broadcast) has run, but this test's own pool connection can briefly
  // lag behind that commit becoming visible — poll rather than a one-shot read.
  await expect(async () => {
    const waitlistRow = await pool.query<{ notified_at: Date | null }>(
      `SELECT notified_at FROM waitlist_entries WHERE session_id = $1 AND user_id = $2`,
      [sessionId, second.id],
    );
    expect(waitlistRow.rows[0].notified_at).not.toBeNull();
  }).toPass({ timeout: 5000 });
});
