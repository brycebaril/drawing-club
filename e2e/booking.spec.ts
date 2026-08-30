import { expect, test } from "@playwright/test";
import { createOneOffSessionAsAdmin, createTestUser, findOpenSlotBase, loginAsUser, pool, withSlotLock } from "./helpers";

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

test("the schedule grid cell's mouseover tooltip carries the detail the compact icon glyph has no room for", async ({
  page,
}) => {
  // The schedule grid shows one session per day+slot cell — a genuinely
  // open slot is required, or the dense migrated dataset's own real
  // session in that cell would render instead of this test's own (same
  // reasoning as recurring.spec.ts/series.spec.ts's use of this helper).
  const description = `mouseover-test-${Date.now()}`;
  // The search (is day X free?) and the actual creation are two separate
  // steps with nothing stopping a concurrent worker from doing the same for
  // the same slot in between — withSlotLock serializes the whole sequence
  // across every process sharing this DB, not just this file's own calls.
  const { sessionId, weekOffset } = await withSlotLock("Evening", async () => {
    const base = await findOpenSlotBase(new Date(), "Evening", [0], 3, 27);
    const todayAt6pm = new Date();
    todayAt6pm.setHours(18, 0, 0, 0);
    const startTime = new Date(todayAt6pm.getTime() + base * 86400000);
    const id = await createOneOffSessionAsAdmin(page, { description, startTime, capacity: 3 });
    return { sessionId: id, weekOffset: Math.floor(base / 7) };
  });

  // Needs the wider Member booking window (30 days) — findOpenSlotBase's
  // base can land past a plain Account Holder's 14-day window, where the
  // cell renders as a non-interactive <div> (isCellInteractive), not the
  // <Link> this test's own locator needs.
  const viewer = await createTestUser({ username: `e2emouseover${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    viewer.id,
  ]);
  await loginAsUser(page, viewer);
  // findOpenSlotBase's base can land well past week 0 — the grid pages a
  // week at a time now (Design Philosophy.dc.html §04), so this needs to
  // request the actual week the created session falls on, not just today's.
  await page.goto(`/app/schedule?week=${weekOffset}`);

  // Scoped to the grid specifically (not the agenda) — both render the same
  // session's link/tooltip in the DOM at once, swapped only by a CSS
  // breakpoint (ScheduleAgenda.tsx), so an unscoped locator now matches two.
  const cell = page.locator("#schedule-grid-view").locator(`a[href*="session_id=${sessionId}"]`);
  await expect(cell).toBeVisible();
  const tooltip = await cell.getAttribute("title");
  // describeCellTooltip (scheduleTypes.ts) — the compact grid glyph itself
  // shows only a one/two-letter session-type code, so this mouseover text
  // is the only place the description, host, and capacity actually surface.
  expect(tooltip).toContain(description);
  expect(tooltip).toContain("Open — needs a host");
  expect(tooltip).toContain("0/3 booked");
});

test("a guest reaches /app/schedule without being redirected, sees capacity, and gets a login CTA instead of a real booking form", async ({
  page,
}) => {
  const description = `guest-schedule-test-${Date.now()}`;
  const { sessionId, weekOffset } = await withSlotLock("Evening", async () => {
    const base = await findOpenSlotBase(new Date(), "Evening", [0], 3, 27);
    const todayAt6pm = new Date();
    todayAt6pm.setHours(18, 0, 0, 0);
    const startTime = new Date(todayAt6pm.getTime() + base * 86400000);
    const id = await createOneOffSessionAsAdmin(page, { description, startTime, capacity: 3 });
    return { sessionId: id, weekOffset: Math.floor(base / 7) };
  });

  // createOneOffSessionAsAdmin logs in as the admin it creates internally —
  // become a genuine guest the same way loginAsUser clears a prior session
  // (about:blank first, so no in-flight request from the admin page keeps
  // the session looking valid).
  await page.goto("about:blank");
  await page.context().clearCookies();

  // week 0 specifically here (not the created session's own week) — this
  // part of the test is about a guest landing on the page's default view at
  // all, not about seeing this particular far-future session yet.
  await page.goto("/app/schedule");
  await expect(page).toHaveURL(/\/app\/schedule$/); // not bounced to /auth/login
  // SiteNav also has its own "Log in" link for guests — scope to <main> to
  // target this page's own guest prompt specifically.
  await expect(page.locator("main").getByRole("link", { name: "Log in" })).toBeVisible();

  // Now the created session's own week, to check its grid cell specifically.
  // Scoped to the grid, not the agenda — both carry this session's link at
  // once (CSS-breakpoint-swapped, ScheduleAgenda.tsx), so unscoped matches two.
  await page.goto(`/app/schedule?week=${weekOffset}`);
  const cell = page.locator("#schedule-grid-view").locator(`a[href*="session_id=${sessionId}"]`);
  await expect(cell).toBeVisible();
  // The open-slot-count badge (SessionCell.tsx) — visible on the grid
  // itself now, not just in the hover tooltip.
  await expect(cell).toContainText("3");

  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await expect(page.getByText(description)).toBeVisible();
  await expect(page.getByRole("button", { name: "Book (uses 1 ticket)" })).toHaveCount(0);
  const loginCta = page.getByRole("link", { name: "Log in to book" });
  await expect(loginCta).toBeVisible();
  await expect(loginCta).toHaveAttribute("href", `/auth/login?redirect=/app/schedule?session_id=${sessionId}`);

  // Following the CTA through login round-trips back to the same session,
  // where the real booking form is now available. Needs the wider Member
  // window (30 days) — findOpenSlotBase's base can land past a plain
  // Account Holder's 14-day window (same reasoning as the mouseover test
  // above).
  const viewer = await createTestUser({ username: `e2eguestschedule${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    viewer.id,
  ]);
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    viewer.id,
  ]);
  await loginCta.click();
  await page.getByLabel("Username").fill(viewer.username);
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`**/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Book (uses 1 ticket)" })).toBeVisible();
});

test("a guest viewing a full session sees a login-to-waitlist CTA, not the real waitlist form", async ({ page }) => {
  const description = `guest-full-test-${Date.now()}`;
  const sessionId = await withSlotLock("Evening", async () => {
    const base = await findOpenSlotBase(new Date(), "Evening", [0], 3, 27);
    const todayAt6pm = new Date();
    todayAt6pm.setHours(18, 0, 0, 0);
    const startTime = new Date(todayAt6pm.getTime() + base * 86400000);
    return createOneOffSessionAsAdmin(page, { description, startTime, capacity: 1 });
  });

  const filler = await createTestUser({ username: `e2eguestfullfiller${Date.now()}` });
  await pool.query(
    `INSERT INTO passes (owner_id, session_id, status, effective_price) VALUES ($1, $2, 'Used', 0)`,
    [filler.id, sessionId],
  );

  await page.goto("about:blank");
  await page.context().clearCookies();

  await page.goto(`/app/schedule?session_id=${sessionId}`);
  await expect(page.getByRole("button", { name: "Join waitlist" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log in to join the waitlist" })).toBeVisible();
});

test("paging the schedule grid forward never widens an Account Holder's booking window", async ({ page }) => {
  // Design Philosophy.dc.html §11 step 4's own required coverage: the week
  // offset only changes what's *visible*, never what's *bookable* — a
  // session beyond the viewer's own window must still render Locked
  // (non-interactive, "Opens {date}") no matter which week paging put it on
  // screen, exactly as it would have without pagination at all.
  const settingsResult = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key IN ('BOOKING_WINDOW_ACCOUNT_DAYS', 'BOOKING_WINDOW_MEMBER_DAYS')`,
  );
  const settings = Object.fromEntries(settingsResult.rows.map((r) => [r.key, Number(r.value)]));
  const accountDays: number = settings.BOOKING_WINDOW_ACCOUNT_DAYS;
  const memberDays: number = settings.BOOKING_WINDOW_MEMBER_DAYS;

  const description = `week-pagination-test-${Date.now()}`;
  // "Afternoon", not this file's usual "Evening" — this test needs a single
  // absolute date strictly between the two windows, not the scarce Evening
  // slot the other three Evening-locked one-off tests in this file already
  // compete over (see CLAUDE.md's Evening-slot-collision notes).
  const created = await withSlotLock("Afternoon", async () => {
    const base = await findOpenSlotBase(new Date(), "Afternoon", [0], accountDays + 2, memberDays - 2);
    const todayAt2pm = new Date();
    todayAt2pm.setHours(14, 0, 0, 0);
    const startTime = new Date(todayAt2pm.getTime() + base * 86400000);
    const id = await createOneOffSessionAsAdmin(page, { description, startTime, capacity: 5 });
    return { id, weekOffset: Math.floor(base / 7) };
  });

  const viewer = await createTestUser({ username: `e2eweekpaging${Date.now()}` }); // AccountHolder by default
  await loginAsUser(page, viewer);

  await page.goto(`/app/schedule?week=${created.weekOffset}`);
  // Locked cells are a non-interactive <div> with an "Opens {date}" line,
  // never a <Link> — the pagination surfaced this far-future session, but
  // it's still not a real booking target. Scoped to the grid specifically
  // (both it and the agenda carry this cell's own title at once, CSS-
  // breakpoint-swapped — ScheduleAgenda.tsx), and via its own title (which
  // carries the unique test description) rather than a bare "Opens" text
  // search — plenty of *other* cells on a 7-day-out week are legitimately
  // Locked too, and would make an unscoped locator ambiguous either way.
  const gridView = page.locator("#schedule-grid-view");
  await expect(gridView.locator(`a[href*="session_id=${created.id}"]`)).toHaveCount(0);
  const lockedCell = gridView.locator(`[title*="${description}"]`);
  await expect(lockedCell).toBeVisible();
  await expect(lockedCell).toContainText(/Opens \w/);

  await page.goto(`/app/schedule?session_id=${created.id}&week=${created.weekOffset}`);
  await expect(page.getByText("Not yet bookable for your account tier.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book (uses 1 ticket)" })).toHaveCount(0);
});
