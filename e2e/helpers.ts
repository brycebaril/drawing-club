import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { Secret, TOTP } from "otpauth";
import { hashPassword } from "@/lib/auth/password";
import { slotFor, startOfDay } from "@/lib/sessions/shared";

// Module-level singleton shared by every spec file that imports it.
// Deliberately never closed here or in any spec file's afterAll — Playwright
// reuses worker processes across test files, so a file that calls
// `pool.end()` in its own afterAll can poison a *different* file that later
// shares that same worker process ("Cannot use a pool after calling end on
// the pool"). Connections close naturally when the worker process exits.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Finds the smallest base day-offset (searching minBase..maxBase) whose
 * `offsets`-derived dates (e.g. [base, base+7, base+21]) are all free of an
 * existing Scheduled session in the given slot — a plain random offset used
 * to collide reliably once the dev DB holds real migrated/recurring session
 * data instead of just sparse fixtures (a legacy-migration re-run populates
 * a genuinely busy near-term calendar), since the admin slot picker shows an
 * occupied slot as a disabled "Booked" label with no checkbox to check.
 * Falls back to minBase if every candidate in range collides (matching the
 * previous unconditional random-offset behavior), so this can't turn a real
 * app bug into a hung test.
 *
 * Occupancy is computed in JS via slotFor/toDateOnly (the app's own local
 * server-time helpers, src/lib/sessions/shared.ts) — not `EXTRACT(HOUR FROM
 * start_time)`/`start_time::date` in SQL. Those evaluate in the DB session's
 * timezone (UTC), but `start_time` is stored as whatever UTC instant the
 * app's local server time converts to (e.g. an 18:00 America/Los_Angeles
 * Evening session lands at 01:00 UTC the *next calendar day*) — a real bug
 * found live: it made the Evening-slot collision check silently inert
 * (checking UTC hour 18-23 against sessions actually stored at UTC hour
 * 0-6) and the day-boundary check wrong by one date for any slot crossing
 * midnight UTC. recurring.spec.ts's own schedule-grid link check caught it
 * after several same-day reruns quietly filled every day-of-week with a
 * same-instant collision this check should have avoided from the start.
 *
 * The scan window is anchored at `startOfDay(now)`, not the raw `now`
 * instant — another real edge found alongside the above: run this any time
 * after a slot's own local start-of-day time (e.g. after 2pm for
 * "Afternoon"), and an unaligned `now.getTime() + minBase * 86400000`
 * window start lands *later* in that candidate day than the slot's actual
 * session start, excluding a real same-day occupant from the scan even
 * though the app's own occupancy checks (checkSlotConflicts,
 * new-series/page.tsx) always reason in whole local calendar days.
 */
export async function findOpenSlotBase(
  now: Date,
  slot: "Morning" | "Afternoon" | "Evening",
  offsets: number[],
  minBase: number,
  maxBase: number,
): Promise<number> {
  const dayStart = startOfDay(now);
  const maxOffset = Math.max(...offsets);
  const windowStart = new Date(dayStart.getTime() + minBase * 86400000);
  const windowEnd = new Date(dayStart.getTime() + (maxBase + maxOffset + 1) * 86400000);
  const occupiedResult = await pool.query<{ start_time: Date }>(
    `SELECT start_time FROM sessions WHERE status = 'Scheduled' AND start_time >= $1 AND start_time < $2`,
    [windowStart, windowEnd],
  );
  const occupiedDays = new Set(
    occupiedResult.rows
      .filter((r) => slotFor(new Date(r.start_time)) === slot)
      .map((r) => toDateOnly(new Date(r.start_time))),
  );

  for (let base = minBase; base <= maxBase; base++) {
    const candidates = offsets.map((offset) => toDateOnly(new Date(now.getTime() + (base + offset) * 86400000)));
    if (candidates.every((day) => !occupiedDays.has(day))) {
      return base;
    }
  }
  return minBase;
}

/**
 * Finds a day-of-week (0-6) for a *new weekly recurring rule* such that
 * every occurrence date implied by `weekOffsets` (added to the nearest
 * on-or-after-today date matching that day-of-week) is free of an existing
 * Scheduled session in the given slot.
 *
 * Deliberately NOT built on findOpenSlotBase, even though it looks similar —
 * that function is for *absolute* date lists (one-off/series bookings,
 * where the app literally creates a session on whatever calendar date was
 * checked). A weekly recurring rule is different: the app resolves "the
 * first date on/after the rule's start_date matching this day-of-week," then
 * repeats every 7 days — the actual occurrence dates depend only on
 * `dayOfWeek`, never on an arbitrary day-count offset from today. A previous
 * version of this test called findOpenSlotBase with a widened maxBase
 * (beyond 6) on the theory that a larger offset would surface new, distinct
 * candidate dates to check — but since the app only ever derives `delta =
 * (dayOfWeek - today.getDay() + 7) % 7`, any offset base > 6 collapses right
 * back onto a day-of-week already covered by base % 7, while findOpenSlotBase
 * kept checking occupancy at the *literal* (unreduced) offset dates — dates
 * the rule would never actually land on. That let a stale "free" result slip
 * through for a day-of-week that's really permanently booked, confirmed
 * directly: 5 of 7 weekdays (Mon-Fri) have a real permanent Evening-slot
 * recurring class from the legacy migration; only Sat/Sun are genuinely
 * open. This function fixes that by only ever testing the 7 real candidate
 * day-of-week values, each against the exact dates the app would actually
 * generate for it.
 */
export async function findOpenWeekday(
  now: Date,
  slot: "Morning" | "Afternoon" | "Evening",
  weekOffsets: number[],
): Promise<number> {
  const dayStart = startOfDay(now);
  const maxWeekOffset = Math.max(...weekOffsets);
  const windowEnd = new Date(dayStart.getTime() + (6 + maxWeekOffset + 1) * 86400000);
  const occupiedResult = await pool.query<{ start_time: Date }>(
    `SELECT start_time FROM sessions WHERE status = 'Scheduled' AND start_time >= $1 AND start_time < $2`,
    [dayStart, windowEnd],
  );
  const occupiedDays = new Set(
    occupiedResult.rows
      .filter((r) => slotFor(new Date(r.start_time)) === slot)
      .map((r) => toDateOnly(new Date(r.start_time))),
  );

  for (let delta = 1; delta <= 6; delta++) {
    const candidates = weekOffsets.map((offset) =>
      toDateOnly(new Date(dayStart.getTime() + (delta + offset) * 86400000)),
    );
    if (candidates.every((day) => !occupiedDays.has(day))) {
      return (now.getDay() + delta) % 7;
    }
  }
  throw new Error(`findOpenWeekday: no open day-of-week found for slot ${slot} in the search window`);
}

const SLOT_LOCK_KEYS: Record<"Morning" | "Afternoon" | "Evening", number> = {
  Morning: 872_001,
  Afternoon: 872_002,
  Evening: 872_003,
};

/**
 * Serializes "find a free day for this slot, then create something there"
 * across every concurrent Playwright worker/process sharing this DB — the
 * actual bug findOpenSlotBase alone can't close. findOpenSlotBase only
 * answers "is day X free right now"; the real reservation (a UI-driven
 * session/rule/series creation) happens as a separate step afterward, with
 * nothing stopping two workers from both reading "day X is free" before
 * either has committed its own creation. A wider search range only lowers
 * the odds of that race, it doesn't close it — this does, the same way a
 * real booking flow would use a row lock, just at the granularity of "one
 * slot" rather than one row, since these tests reserve a slot before any
 * row backing it exists yet. Uses a dedicated connection (advisory locks
 * are session-scoped: acquire and release must happen on the same one) —
 * callers pass everything from the findOpenSlotBase call through the
 * actual creation inside `fn`, not just the search.
 */
export async function withSlotLock<T>(
  slot: "Morning" | "Afternoon" | "Evening",
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SLOT_LOCK_KEYS[slot]]);
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SLOT_LOCK_KEYS[slot]]);
    client.release();
  }
}

export async function createTestUser(opts: {
  username: string;
  baseRole?: "AccountHolder" | "Admin";
  password?: string;
}) {
  // Test files run in parallel across workers/processes — a caller-supplied
  // `Date.now()`-based username alone isn't unique enough (seen colliding
  // across files in practice), so always add our own entropy on top.
  const username = `${opts.username}${Math.random().toString(36).slice(2, 8)}`;
  const password = opts.password ?? "e2e-test-password-123";
  const passwordHash = await hashPassword(password);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash, email, email_verified_at, base_role, status)
     VALUES ($1, $2, $3, now(), $4, 'Active')
     RETURNING id`,
    [username, passwordHash, `${username}@example.test`, opts.baseRole ?? "AccountHolder"],
  );
  return { id: result.rows[0].id, username, password };
}

function totpCodeFor(secretBase32: string): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32.trim()),
  }).generate();
}

/**
 * Logs in via the real UI. Handles both MFA cases transparently: first-time
 * enrollment (redirects to /auth/mfa-setup, same flow a real first-time
 * Admin/Controller login goes through) and a *returning* already-enrolled
 * account, which the login page prompts for a code on without navigating
 * anywhere — for that case this fetches the account's stored mfa_secret
 * directly (test-only shortcut; there's no way to read a live TOTP code
 * from the UI itself).
 */
export async function loginAsUser(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  // /auth/login is guest-only (src/lib/auth/rbac.ts) — clear any previous
  // user's session first, or the page redirects straight past the form.
  // Navigating to about:blank first discards the previous page's in-flight
  // requests (production-mode <Link> prefetches, SessionProvider's mount-time
  // session fetch — neither excluded by src/proxy.ts's matcher) before
  // clearing cookies; without it, a call sequenced right after a hard
  // page.goto() with no further interaction (e.g. recurring.spec.ts's second
  // login) can race one of those still-in-flight requests against
  // clearCookies(), leaving the browser looking authenticated when
  // /auth/login's request is evaluated — server-side it just 307s straight
  // back to /dashboard (src/proxy.ts's guest-only guard), so the login form
  // never renders and every subsequent locator call in this function hangs
  // until the test's own timeout.
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/auth/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();

  const totpInput = page.getByLabel(/6-digit code/);
  await Promise.race([
    page.waitForURL(/\/(auth\/mfa-setup|dashboard)/),
    totpInput.waitFor({ state: "visible" }),
  ]);

  if (page.url().includes("/auth/mfa-setup")) {
    const secret = await page.locator("code").textContent();
    await page.getByLabel(/6-digit code/).fill(totpCodeFor(secret!));
    await page.getByRole("button", { name: "Confirm & enable MFA" }).click();
    await page.waitForURL("**/dashboard");
  } else if (await totpInput.isVisible().catch(() => false)) {
    const secretRow = await pool.query<{ mfa_secret: string | null }>(
      `SELECT mfa_secret FROM users WHERE username = $1`,
      [user.username],
    );
    await totpInput.fill(totpCodeFor(secretRow.rows[0].mfa_secret!));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL("**/dashboard");
  }
}

/** Formats a Date as the local-time string a datetime-local input expects. */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Creates a fresh Admin, logs in as them, and creates a one-off session via the real UI. */
export async function createOneOffSessionAsAdmin(
  page: Page,
  opts: { description: string; startTime: Date; capacity: number },
): Promise<string> {
  const admin = await createTestUser({
    username: `e2eadmin${Date.now()}${Math.random()}`,
    baseRole: "Admin",
  });
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
