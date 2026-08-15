import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getSettingNumber } from "@/lib/settings";
import { isCancellable } from "@/lib/cancellation";
import { sendEmail } from "@/lib/email/sender";
import { viewerBookingWindowDays } from "./sessionStatus";

export type BookSessionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not-verified" | "no-pass" | "full" | "already-booked" | "not-found" | "too-far";
    };

/**
 * Books `sessionId` for `userId` by spending one of their Available passes.
 * Re-validates everything server-side (email verification, booking window,
 * capacity) regardless of what the UI already checked — the UI's disabled
 * states are a UX affordance, not a security boundary
 * (docs/SecurityDocument.md §3). Session capacity and pass selection are
 * both row-locked so concurrent bookings can't oversell the last spot.
 */
export async function bookSession(userId: string, sessionId: string): Promise<BookSessionResult> {
  const ctx = await getUserAuthContext(userId);
  if (!ctx || ctx.status !== "Active") return { ok: false, reason: "not-found" };
  if (!ctx.emailVerified) return { ok: false, reason: "not-verified" };

  const [accountDays, memberDays] = await Promise.all([
    getSettingNumber("BOOKING_WINDOW_ACCOUNT_DAYS"),
    getSettingNumber("BOOKING_WINDOW_MEMBER_DAYS"),
  ]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionRow = await client.query<{ max_capacity: number; start_time: Date }>(
      `SELECT max_capacity, start_time FROM sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (sessionRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-found" };
    }
    const session = sessionRow.rows[0];

    const windowDays = viewerBookingWindowDays(ctx.roles, accountDays, memberDays);
    const windowEnd = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);
    if (new Date(session.start_time) > windowEnd) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "too-far" };
    }

    const existing = await client.query(
      `SELECT id FROM passes WHERE owner_id = $1 AND session_id = $2 AND status = 'Used'`,
      [userId, sessionId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already-booked" };
    }

    const countRow = await client.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE session_id = $1 AND status = 'Used'`,
      [sessionId],
    );
    if (Number(countRow.rows[0].count) >= session.max_capacity) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "full" };
    }

    // FIFO: oldest available pass first. Skip rows another concurrent
    // booking already has locked rather than blocking on them.
    const passRow = await client.query<{ id: string }>(
      `SELECT id FROM passes
       WHERE owner_id = $1 AND status = 'Available'
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [userId],
    );
    if (passRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "no-pass" };
    }

    await client.query(`UPDATE passes SET status = 'Used', session_id = $1 WHERE id = $2`, [
      sessionId,
      passRow.rows[0].id,
    ]);

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type CancelBookingResult = { ok: true } | { ok: false; reason: "not-found" | "not-cancellable" };

export async function cancelBooking(userId: string, sessionId: string): Promise<CancelBookingResult> {
  const cutoffHours = await getSettingNumber("CANCELLATION_CUTOFF_HOURS");

  const client = await pool.connect();
  let shouldNotifyWaitlist = false;
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{ id: string }>(
      `SELECT id FROM passes WHERE owner_id = $1 AND session_id = $2 AND status = 'Used' FOR UPDATE`,
      [userId, sessionId],
    );
    if (passRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-found" };
    }

    const sessionRow = await client.query<{ start_time: Date; max_capacity: number }>(
      `SELECT start_time, max_capacity FROM sessions WHERE id = $1`,
      [sessionId],
    );
    if (sessionRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-found" };
    }
    const { start_time: startTime, max_capacity: maxCapacity } = sessionRow.rows[0];

    if (!isCancellable(new Date(startTime), cutoffHours)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-cancellable" };
    }

    const countRow = await client.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE session_id = $1 AND status = 'Used'`,
      [sessionId],
    );
    shouldNotifyWaitlist = Number(countRow.rows[0].count) >= maxCapacity;

    await client.query(`UPDATE passes SET status = 'Available', session_id = NULL WHERE id = $1`, [
      passRow.rows[0].id,
    ]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Outside the transaction: sending email shouldn't hold the DB lock, and a
  // delivery hiccup shouldn't roll back a cancellation that already succeeded.
  if (shouldNotifyWaitlist) {
    await broadcastWaitlistOpening(sessionId);
  }

  return { ok: true };
}

/**
 * Design Doc §6.4: broadcasts to everyone on the waitlist who hasn't
 * already been notified about *an* opening (not just this one) — repeat
 * alerts for every subsequent cancellation aren't the intent, per the
 * notified_at field's original design (docs/DesignDocument.md §13).
 */
async function broadcastWaitlistOpening(sessionId: string): Promise<void> {
  const entries = await pool.query<{ id: string; email: string; username: string }>(
    `SELECT w.id, u.email, u.username
     FROM waitlist_entries w
     JOIN users u ON u.id = w.user_id
     WHERE w.session_id = $1 AND w.notified_at IS NULL`,
    [sessionId],
  );

  for (const entry of entries.rows) {
    await sendEmail({
      to: entry.email,
      subject: "A spot opened up",
      body: `Hi ${entry.username},\n\nA spot just opened in a session you're waitlisted for. It's first come, first served — log in and book it before someone else does.`,
    });
    await pool.query(`UPDATE waitlist_entries SET notified_at = now() WHERE id = $1`, [entry.id]);
  }
}

export type JoinWaitlistResult = { ok: true } | { ok: false; reason: "already-on-waitlist" };

export async function joinWaitlist(userId: string, sessionId: string): Promise<JoinWaitlistResult> {
  try {
    await pool.query(`INSERT INTO waitlist_entries (session_id, user_id) VALUES ($1, $2)`, [
      sessionId,
      userId,
    ]);
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "already-on-waitlist" };
    }
    throw error;
  }
}
