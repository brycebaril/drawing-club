import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext, type UserAuthContext } from "@/lib/auth/roles";
import { getSettingNumber } from "@/lib/settings";
import { isCancellable } from "@/lib/cancellation";
import { sendEmail } from "@/lib/email/sender";
import { viewerBookingWindowDays } from "./sessionStatus";

export type ViewerEligibilityResult =
  | { ok: true; ctx: UserAuthContext }
  | { ok: false; reason: "not-found" | "not-verified" };

/**
 * Shared by every booking-adjacent mutation (bookSession, bookSeriesSeat,
 * joinWaitlist): resolves the acting user and checks the two invariants
 * every one of them needs — an Active account with a verified email.
 * Previously duplicated in bookSession and bookSeriesSeat (and joinWaitlist
 * skipped it entirely, a real gap — see CLAUDE.md).
 */
export async function resolveViewerEligibility(userId: string): Promise<ViewerEligibilityResult> {
  const ctx = await getUserAuthContext(userId);
  if (!ctx || ctx.status !== "Active") return { ok: false, reason: "not-found" };
  if (!ctx.emailVerified) return { ok: false, reason: "not-verified" };
  return { ok: true, ctx };
}

/** The instant beyond which `roles` can't yet book, per the configured per-tier booking windows. */
export async function resolveBookingWindowEnd(roles: UserAuthContext["roles"]): Promise<Date> {
  const [accountDays, memberDays] = await Promise.all([
    getSettingNumber("BOOKING_WINDOW_ACCOUNT_DAYS"),
    getSettingNumber("BOOKING_WINDOW_MEMBER_DAYS"),
  ]);
  const windowDays = viewerBookingWindowDays(roles, accountDays, memberDays);
  return new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);
}

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
  const eligibility = await resolveViewerEligibility(userId);
  if (!eligibility.ok) return eligibility;
  const windowEnd = await resolveBookingWindowEnd(eligibility.ctx.roles);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionRow = await client.query<{
      max_capacity: number;
      start_time: Date;
      status: string;
      series_id: string | null;
    }>(`SELECT max_capacity, start_time, status, series_id FROM sessions WHERE id = $1 FOR UPDATE`, [
      sessionId,
    ]);
    if (
      sessionRow.rowCount === 0 ||
      sessionRow.rows[0].status !== "Scheduled" ||
      sessionRow.rows[0].series_id !== null
    ) {
      // A Canceled session shouldn't accept new bookings, and a series
      // occurrence must go through bookSeriesSeat (numbered-seat capacity),
      // not this general-admission path.
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-found" };
    }
    const session = sessionRow.rows[0];

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

    // FIFO: oldest available pass first (by grant time, not id — a
    // gen_random_uuid() has no chronological order). Skip rows another
    // concurrent booking already has locked rather than blocking on them.
    const passRow = await client.query<{ id: string }>(
      `SELECT id FROM passes
       WHERE owner_id = $1 AND status = 'Available'
       ORDER BY created_at, id
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

export type CancelBookingResult = { ok: true } | { ok: false; reason: "not-found" };

/**
 * Shared by the user-initiated cancel path (this file's cancelBooking and
 * src/lib/series/actions.ts's cancelSeriesSeatDate — exported specifically
 * so the series path doesn't reimplement this same booked-count/refund-vs-
 * forfeit branching, a real "series path drifts from the generic path" risk
 * CLAUDE.md already documents happening once before) and the admin-forced
 * release path (Phase 4's ban/suspend auto-cancellation) — must run inside
 * an already-open transaction that holds a lock on the session row, so the
 * capacity count and the release are atomic together.
 *
 * `refund`: false means the pass is marked 'Forfeited' instead of
 * 'Available' — a late (within-cutoff) voluntary cancellation frees the
 * seat (booked-count only counts 'Used', so a Forfeited pass doesn't block
 * it) without giving the member their pass back. Admin-forced release
 * always passes true regardless of cutoff — an org-initiated action (ban,
 * session cancellation) isn't the member choosing to cancel late, so it
 * shouldn't cost them the pass.
 */
export async function releaseBookedPass(
  client: PoolClient,
  sessionId: string,
  passId: string,
  maxCapacity: number,
  refund: boolean,
): Promise<boolean> {
  const countRow = await client.query<{ count: string }>(
    `SELECT count(*) FROM passes WHERE session_id = $1 AND status = 'Used'`,
    [sessionId],
  );
  const wasFull = Number(countRow.rows[0].count) >= maxCapacity;

  if (refund) {
    await client.query(`UPDATE passes SET status = 'Available', session_id = NULL WHERE id = $1`, [passId]);
  } else {
    // session_id stays set — a record of which session it was forfeited
    // for, harmless for capacity counting since that only counts 'Used'.
    await client.query(`UPDATE passes SET status = 'Forfeited' WHERE id = $1`, [passId]);
  }

  return wasFull;
}

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
      `SELECT start_time, max_capacity FROM sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (sessionRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-found" };
    }
    const { start_time: startTime, max_capacity: maxCapacity } = sessionRow.rows[0];

    // Canceling is always allowed now — within the cutoff it just forfeits
    // the pass instead of refunding it (the member confirms this in the UI
    // before submitting; see SessionDetailsPanel's CancelableNoRefund branch).
    const refund = isCancellable(new Date(startTime), cutoffHours);

    shouldNotifyWaitlist = await releaseBookedPass(client, sessionId, passRow.rows[0].id, maxCapacity, refund);

    // No-op unless this booking was actually a numbered series seat (bookSession
    // itself now refuses series sessions, but a pre-existing series booking can
    // still reach this generic path rather than cancelSeriesSeatDateAction) —
    // otherwise the seat stays permanently blocked for everyone even though no
    // one holds a live pass for it.
    await client.query(`DELETE FROM seat_reservations WHERE session_id = $1 AND user_id = $2`, [
      sessionId,
      userId,
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
 * Admin-forced release (Phase 4: ban/suspend cancels a user's upcoming
 * bookings) — same release logic as cancelBooking, but skips the cutoff
 * check entirely, since the user's own cancellation window doesn't apply
 * to an account-status action initiated by an admin.
 */
export async function releaseAllFutureBookingsForUser(userId: string): Promise<void> {
  const upcoming = await pool.query<{ session_id: string; pass_id: string }>(
    `SELECT p.session_id, p.id AS pass_id
     FROM passes p
     JOIN sessions s ON s.id = p.session_id
     WHERE p.owner_id = $1 AND p.status = 'Used' AND s.start_time > now()`,
    [userId],
  );

  for (const row of upcoming.rows) {
    const client = await pool.connect();
    let shouldNotifyWaitlist = false;
    try {
      await client.query("BEGIN");
      const sessionRow = await client.query<{ max_capacity: number }>(
        `SELECT max_capacity FROM sessions WHERE id = $1 FOR UPDATE`,
        [row.session_id],
      );
      if (sessionRow.rowCount === 0) {
        await client.query("ROLLBACK");
        continue;
      }
      shouldNotifyWaitlist = await releaseBookedPass(
        client,
        row.session_id,
        row.pass_id,
        sessionRow.rows[0].max_capacity,
        true, // admin-forced release always refunds, regardless of cutoff
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (shouldNotifyWaitlist) {
      await broadcastWaitlistOpening(row.session_id);
    }
  }
}

/**
 * Admin session cancellation (Phase 5: one-off and recurring-occurrence
 * cancellation share this; Phase 6: series occurrences too; Phase 7: the
 * edit-driven cancel-and-regenerate path too) — releases every booked pass
 * on the session (any owner, not just one user), clears any
 * seat_reservations rows for it, emails each released booker, notifies the
 * waitlist once if it was full, and marks the session Canceled. A no-op if
 * the session doesn't exist or is already Canceled.
 */
export async function releaseAllBookingsForSession(sessionId: string): Promise<void> {
  const client = await pool.connect();
  let shouldNotifyWaitlist = false;
  let releasedBookers: { email: string; username: string }[] = [];
  let sessionType = "";
  let sessionStartTime: Date | null = null;
  try {
    await client.query("BEGIN");

    const sessionRow = await client.query<{ max_capacity: number; status: string; session_type: string; start_time: Date }>(
      `SELECT max_capacity, status, session_type, start_time FROM sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (sessionRow.rowCount === 0 || sessionRow.rows[0].status === "Canceled") {
      await client.query("ROLLBACK");
      return;
    }
    const { max_capacity: maxCapacity } = sessionRow.rows[0];
    sessionType = sessionRow.rows[0].session_type;
    sessionStartTime = new Date(sessionRow.rows[0].start_time);

    const passRows = await client.query<{ id: string; email: string; username: string }>(
      `SELECT p.id, u.email, u.username
       FROM passes p
       JOIN users u ON u.id = p.owner_id
       WHERE p.session_id = $1 AND p.status = 'Used'
       FOR UPDATE OF p`,
      [sessionId],
    );
    // Computed once, before releasing anything — releasing passes one at a
    // time would make "was full" false by the second release.
    shouldNotifyWaitlist = (passRows.rowCount ?? 0) >= maxCapacity;
    releasedBookers = passRows.rows.map((row) => ({ email: row.email, username: row.username }));

    for (const pass of passRows.rows) {
      await client.query(`UPDATE passes SET status = 'Available', session_id = NULL WHERE id = $1`, [
        pass.id,
      ]);
    }

    // No-op for ordinary (non-series) sessions — cleans up any numbered-seat
    // assignments a canceled series occurrence held, so they don't linger
    // pointing at a Canceled session (Phase 6).
    await client.query(`DELETE FROM seat_reservations WHERE session_id = $1`, [sessionId]);

    await client.query(`UPDATE sessions SET status = 'Canceled' WHERE id = $1`, [sessionId]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Outside the transaction, same reasoning as cancelBooking's own email
  // step: delivery shouldn't hold the DB lock or roll back an
  // already-successful release. Each send is isolated — one bad address
  // shouldn't stop the rest of the bookers from being notified, or skip
  // the waitlist broadcast below.
  for (const booker of releasedBookers) {
    try {
      await sendEmail({
        to: booker.email,
        subject: "Your booking was canceled",
        body: `Hi ${booker.username},\n\nAn admin canceled ${sessionType} — ${sessionStartTime?.toLocaleString() ?? "a session"} you were booked into. Your pass has been returned to your balance.`,
      });
    } catch (error) {
      console.error(`Failed to email canceled-booking notice to ${booker.email}:`, error);
    }
  }

  if (shouldNotifyWaitlist) {
    await broadcastWaitlistOpening(sessionId);
  }
}

/**
 * Design Doc §6.4: broadcasts to everyone on the waitlist who hasn't
 * already been notified about *an* opening (not just this one) — repeat
 * alerts for every subsequent cancellation aren't the intent, per the
 * notified_at field's original design (docs/DesignDocument.md §13).
 */
export async function broadcastWaitlistOpening(sessionId: string): Promise<void> {
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

export type JoinWaitlistResult =
  | { ok: true }
  | { ok: false; reason: "already-on-waitlist" | "not-found" | "not-verified" };

export async function joinWaitlist(userId: string, sessionId: string): Promise<JoinWaitlistResult> {
  const eligibility = await resolveViewerEligibility(userId);
  if (!eligibility.ok) return eligibility;

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
