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
  await expect(page.getByText("Available tickets: 0")).toBeVisible();
  // Passes are now purchased through real Stripe Checkout (Phase 8) rather
  // than a dev-only grant button — set the fixture up directly, same as
  // every other spec file's pass provisioning.
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`,
    [member.id],
  );
  await page.reload();
  await expect(page.getByText("Available tickets: 1")).toBeVisible();

  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Cancel registration" })).toBeVisible();

  await page.goto("/app/wallet");
  await expect(page.getByText("Available tickets: 0")).toBeVisible();

  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Cancel registration" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Book (uses 1 ticket)" })).toBeVisible();

  await page.goto("/app/wallet");
  await expect(page.getByText("Available tickets: 1")).toBeVisible();
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
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  // waitForURL alone resolves instantly here — the redirect lands on the
  // exact URL already loaded (session_id unchanged), so it doesn't prove
  // the booking committed. The very next line's loginAsUser immediately
  // navigates to about:blank, which cancels a still-in-flight request from
  // this page — caught live: this exact race intermittently left the
  // session not actually full yet when `second` loaded it below, failing
  // the "Join waitlist" visibility check with no code-level cause. Poll for
  // the real DB effect first (same fix applied to the forfeiture test below
  // after it hit the identical bug on its own join-waitlist step).
  await expect(async () => {
    const passRow = await pool.query<{ status: string }>(
      `SELECT status FROM passes WHERE owner_id = $1 AND session_id = $2 AND status = 'Used'`,
      [first.id, sessionId],
    );
    expect(passRow.rowCount).toBe(1);
  }).toPass({ timeout: 5000 });

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

test("canceling within the cutoff forfeits the pass but still frees the seat and notifies the waitlist", async ({
  page,
}) => {
  // 2 hours out: inside the default 24h CANCELLATION_CUTOFF_HOURS, so
  // canceling should now require the no-refund confirmation rather than
  // being blocked outright.
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const sessionId = await createOneOffSessionAsAdmin(page, {
    description: `late-cancel-test-${Date.now()}`,
    startTime,
    capacity: 1,
  });

  const first = await createTestUser({ username: `e2elatefirst${Date.now()}` });
  await loginAsUser(page, first);
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 12.34)`,
    [first.id],
  );
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Book (uses 1 ticket)" }).click();
  // Not just page.waitForURL(sameUrlItStartedOn) — the join/book redirect
  // lands back on the exact URL already loaded (session_id doesn't change),
  // so that resolves instantly without proving the mutation committed (the
  // documented "sameUrlItStartedOn" trap, CLAUDE.md's CMS implementation
  // notes). That trivial resolution let the very next step's loginAsUser
  // race ahead into its own page.goto("about:blank") hop — which discards
  // any still-in-flight request from the previous page — cancelling this
  // click's own form submission before the server ever processed it. Found
  // live: booking/joining intermittently silently no-op'd, not from a real
  // backend bug. Poll for the actual DB effect instead.
  await expect(async () => {
    const passRow = await pool.query<{ status: string }>(
      `SELECT status FROM passes WHERE owner_id = $1 AND session_id = $2 AND status = 'Used'`,
      [first.id, sessionId],
    );
    expect(passRow.rowCount).toBe(1);
  }).toPass({ timeout: 5000 });

  const second = await createTestUser({ username: `e2elatesecond${Date.now()}` });
  await loginAsUser(page, second);
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  // Same reasoning as the booking step above — wait for the real DB effect,
  // not the no-op-resolving waitForURL, before the next loginAsUser's
  // about:blank hop can cancel this request mid-flight.
  await expect(async () => {
    const waitlistRow = await pool.query(`SELECT id FROM waitlist_entries WHERE session_id = $1 AND user_id = $2`, [
      sessionId,
      second.id,
    ]);
    expect(waitlistRow.rowCount).toBe(1);
  }).toPass({ timeout: 5000 });

  await loginAsUser(page, first);
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await expect(page.getByText(/too close to start for a refund/)).toBeVisible();
  await page.getByLabel(/won.t get my ticket back if I cancel now/).check();
  await page.getByRole("button", { name: "Cancel without refund" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);

  await expect(async () => {
    const passRow = await pool.query<{ status: string; session_id: string | null }>(
      `SELECT status, session_id FROM passes WHERE owner_id = $1`,
      [first.id],
    );
    // Forfeited, not Available — no refund. session_id stays set as a
    // record of which session it was forfeited for.
    expect(passRow.rows[0].status).toBe("Forfeited");
    expect(passRow.rows[0].session_id).toBe(sessionId);

    const waitlistRow = await pool.query<{ notified_at: Date | null }>(
      `SELECT notified_at FROM waitlist_entries WHERE session_id = $1 AND user_id = $2`,
      [sessionId, second.id],
    );
    expect(waitlistRow.rows[0].notified_at).not.toBeNull();
  }).toPass({ timeout: 5000 });

  // The seat is genuinely free again (Forfeited doesn't count toward
  // booked-count) — a third user can book it.
  const third = await createTestUser({ username: `e2elatethird${Date.now()}` });
  await loginAsUser(page, third);
  await pool.query(
    `INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`,
    [third.id],
  );
  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Book (uses 1 ticket)" })).toBeVisible();
});
