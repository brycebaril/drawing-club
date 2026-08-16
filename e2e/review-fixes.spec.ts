import { expect, test } from "@playwright/test";
import { createTestUser, pool } from "./helpers";
import { bookSession, cancelBooking, joinWaitlist } from "@/lib/booking/actions";
import { bookSeriesSeat } from "@/lib/series/actions";

// Direct library-level checks for guards found by a holistic code review
// that aren't easily reachable through a full browser UI flow — same
// pattern as series.spec.ts's direct bookSeriesSeat conflict check.

test("bookSession refuses a series occurrence — must go through bookSeriesSeat instead", async () => {
  const admin = await createTestUser({ username: `e2ereviewadmin${Date.now()}`, baseRole: "Admin" });
  const seriesResult = await pool.query<{ id: string }>(
    `INSERT INTO series (name, seat_count, created_by) VALUES ($1, 2, $2) RETURNING id`,
    [`review-fix-series-${Date.now()}`, admin.id],
  );
  const seriesId = seriesResult.rows[0].id;
  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, max_capacity, is_ticketed, series_id)
     VALUES ('X', now() + interval '7 days', now() + interval '7 days 2 hours', 2, true, $1)
     RETURNING id`,
    [seriesId],
  );
  const sessionId = sessionResult.rows[0].id;

  const member = await createTestUser({ username: `e2ereviewm1${Date.now()}` });
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    member.id,
  ]);

  const result = await bookSession(member.id, sessionId);
  expect(result).toEqual({ ok: false, reason: "not-found" });
});

test("bookSession refuses a Canceled session", async () => {
  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, max_capacity, is_ticketed, status)
     VALUES ('R', now() + interval '7 days', now() + interval '7 days 2 hours', 5, true, 'Canceled')
     RETURNING id`,
  );
  const sessionId = sessionResult.rows[0].id;

  const member = await createTestUser({ username: `e2ereviewm2${Date.now()}` });
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    member.id,
  ]);

  const result = await bookSession(member.id, sessionId);
  expect(result).toEqual({ ok: false, reason: "not-found" });
});

test("cancelBooking cleans up seat_reservations for a series booking", async () => {
  const admin = await createTestUser({ username: `e2ereviewadmin2${Date.now()}`, baseRole: "Admin" });
  const seriesResult = await pool.query<{ id: string }>(
    `INSERT INTO series (name, seat_count, created_by) VALUES ($1, 2, $2) RETURNING id`,
    [`review-fix-series2-${Date.now()}`, admin.id],
  );
  const seriesId = seriesResult.rows[0].id;
  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, max_capacity, is_ticketed, series_id)
     VALUES ('X', now() + interval '7 days', now() + interval '7 days 2 hours', 2, true, $1)
     RETURNING id`,
    [seriesId],
  );
  const sessionId = sessionResult.rows[0].id;

  const member = await createTestUser({ username: `e2ereviewm3${Date.now()}` });
  await pool.query(`UPDATE users SET membership_expires_at = now() + interval '60 days' WHERE id = $1`, [
    member.id,
  ]);
  await pool.query(`INSERT INTO passes (owner_id, status, effective_price) VALUES ($1, 'Available', 0)`, [
    member.id,
  ]);

  const bookResult = await bookSeriesSeat(member.id, seriesId, 1, [sessionId]);
  expect(bookResult).toEqual({ ok: true });

  const beforeCancel = await pool.query<{ count: string }>(
    `SELECT count(*) FROM seat_reservations WHERE session_id = $1`,
    [sessionId],
  );
  expect(Number(beforeCancel.rows[0].count)).toBe(1);

  // Cancels via the generic path rather than cancelSeriesSeatDate — the
  // scenario the review found: both operate on the same session_id.
  const cancelResult = await cancelBooking(member.id, sessionId);
  expect(cancelResult).toEqual({ ok: true });

  const afterCancel = await pool.query<{ count: string }>(
    `SELECT count(*) FROM seat_reservations WHERE session_id = $1`,
    [sessionId],
  );
  expect(Number(afterCancel.rows[0].count)).toBe(0);

  const passRow = await pool.query<{ status: string }>(
    `SELECT status FROM passes WHERE owner_id = $1`,
    [member.id],
  );
  expect(passRow.rows[0].status).toBe("Available");
});

test("pass selection is FIFO by grant time, not by random id order", async () => {
  const member = await createTestUser({ username: `e2ereviewm4${Date.now()}` });

  // Insert the pass that should be picked FIRST with a LATER created_at
  // than its id-sort position would suggest, and vice versa for the second
  // — proves the fix reads created_at, not just falls through to matching
  // insertion order (which id order would coincidentally produce here).
  const older = await pool.query<{ id: string }>(
    `INSERT INTO passes (owner_id, status, effective_price, created_at)
     VALUES ($1, 'Available', 0, now() - interval '2 days')
     RETURNING id`,
    [member.id],
  );
  const newer = await pool.query<{ id: string }>(
    `INSERT INTO passes (owner_id, status, effective_price, created_at)
     VALUES ($1, 'Available', 0, now() - interval '1 hour')
     RETURNING id`,
    [member.id],
  );

  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', now() + interval '7 days', now() + interval '7 days 2 hours', 5, true)
     RETURNING id`,
  );

  const result = await bookSession(member.id, sessionResult.rows[0].id);
  expect(result).toEqual({ ok: true });

  const usedPass = await pool.query<{ id: string }>(
    `SELECT id FROM passes WHERE owner_id = $1 AND status = 'Used'`,
    [member.id],
  );
  expect(usedPass.rows[0].id).toBe(older.rows[0].id);
  expect(usedPass.rows[0].id).not.toBe(newer.rows[0].id);
});

test("joinWaitlist refuses a Suspended account", async () => {
  const member = await createTestUser({ username: `e2ereviewm5${Date.now()}` });
  await pool.query(`UPDATE users SET status = 'Suspended' WHERE id = $1`, [member.id]);

  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, max_capacity, is_ticketed)
     VALUES ('R', now() + interval '7 days', now() + interval '7 days 2 hours', 1, true)
     RETURNING id`,
  );

  const result = await joinWaitlist(member.id, sessionResult.rows[0].id);
  expect(result).toEqual({ ok: false, reason: "not-found" });
});
