import { expect, test } from "@playwright/test";
import { createOneOffSessionAsAdmin, createTestUser, loginAsUser, pool } from "./helpers";

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
  // Passes are now purchased through real Stripe Checkout (Phase 8) rather
  // than a dev-only grant button — set the fixture up directly, same as
  // every other spec file's pass provisioning.
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`,
    [member.id],
  );
  await page.reload();
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
  // Specific enough not to also match the schedule page's own status-key
  // Legend, which has its own shorter "You're on the waitlist" text as a
  // permanent, always-visible part of the page (not scoped to this session).
  await expect(page.getByText(/on the waitlist — we.ll email you/)).toBeVisible();

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
