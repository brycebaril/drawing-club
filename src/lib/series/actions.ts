import { pool } from "@/lib/db/pool";
import { getSettingNumber } from "@/lib/settings";
import { isCancellable } from "@/lib/cancellation";
import {
  releaseAllBookingsForSession,
  broadcastWaitlistOpening,
  resolveViewerEligibility,
  resolveBookingWindowEnd,
} from "@/lib/booking/actions";
import { selectSessionIdsToCancel, type CancelableSession } from "@/lib/recurrence/actions";

export type BookSeriesSeatResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not-verified"
        | "no-pass"
        | "already-booked"
        | "seat-taken"
        | "different-seat-already-held"
        | "not-found"
        | "too-far"
        | "no-dates";
    };

/**
 * Books `seatNumber` on every session in `sessionIds` (all belonging to
 * `seriesId`) for `userId`, one pass per date — all-or-nothing: if any date
 * fails (seat just taken, out of the viewer's booking window, no pass
 * available), the whole submission is rolled back and nothing is booked.
 * Sessions are locked in ascending start_time order so two concurrent
 * bookings touching overlapping dates can't deadlock each other.
 */
export async function bookSeriesSeat(
  userId: string,
  seriesId: string,
  seatNumber: number,
  sessionIds: string[],
): Promise<BookSeriesSeatResult> {
  if (sessionIds.length === 0) return { ok: false, reason: "no-dates" };

  const eligibility = await resolveViewerEligibility(userId);
  if (!eligibility.ok) return eligibility;
  const windowEnd = await resolveBookingWindowEnd(eligibility.ctx.roles);

  const membership = await pool.query<{ id: string; start_time: Date }>(
    `SELECT id, start_time FROM sessions WHERE id = ANY($1::uuid[]) AND series_id = $2`,
    [sessionIds, seriesId],
  );
  if (membership.rowCount !== sessionIds.length) return { ok: false, reason: "not-found" };
  const orderedIds = membership.rows
    .slice()
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .map((r) => r.id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Design decision: one seat per member per series — a member who
    // already holds a different seat number anywhere in this series can't
    // pick a second one. Re-checked here (inside the transaction, right
    // before any locking/inserting begins) rather than only before it opens
    // — no schema constraint backs this invariant (seat_reservations is
    // only unique on (session_id, seat_number)), so this narrows but
    // doesn't fully close the race against a second concurrent request
    // touching a disjoint set of sessions in the same series.
    const existingSeat = await client.query<{ seat_number: number }>(
      `SELECT DISTINCT sr.seat_number
       FROM seat_reservations sr
       JOIN sessions s ON s.id = sr.session_id
       WHERE s.series_id = $1 AND sr.user_id = $2`,
      [seriesId, userId],
    );
    if (existingSeat.rows.some((row) => row.seat_number !== seatNumber)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "different-seat-already-held" };
    }

    for (const sessionId of orderedIds) {
      const sessionRow = await client.query<{ start_time: Date; status: string }>(
        `SELECT start_time, status FROM sessions WHERE id = $1 FOR UPDATE`,
        [sessionId],
      );
      if (sessionRow.rowCount === 0 || sessionRow.rows[0].status !== "Scheduled") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "not-found" };
      }
      if (new Date(sessionRow.rows[0].start_time) > windowEnd) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "too-far" };
      }

      const seatTaken = await client.query(
        `SELECT id FROM seat_reservations WHERE session_id = $1 AND seat_number = $2`,
        [sessionId, seatNumber],
      );
      if ((seatTaken.rowCount ?? 0) > 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "seat-taken" };
      }

      const alreadyBooked = await client.query(
        `SELECT id FROM passes WHERE owner_id = $1 AND session_id = $2 AND status = 'Used'`,
        [userId, sessionId],
      );
      if ((alreadyBooked.rowCount ?? 0) > 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "already-booked" };
      }

      // FIFO: oldest available pass first (by grant time), skip rows
      // another concurrent booking already has locked (same pattern as
      // bookSession).
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
      await client.query(
        `INSERT INTO seat_reservations (session_id, user_id, pass_id, seat_number) VALUES ($1, $2, $3, $4)`,
        [sessionId, userId, passRow.rows[0].id, seatNumber],
      );
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "seat-taken" };
    }
    throw error;
  } finally {
    client.release();
  }
}

export type CancelSeriesSeatDateResult = { ok: true } | { ok: false; reason: "not-found" };

/**
 * Releases one member's seat reservation for one date in a series — same
 * cutoff rule as an ordinary cancelBooking, plus clearing the seat_reservations
 * row. No bulk "cancel my whole series" action exists; this is per-date only.
 */
export async function cancelSeriesSeatDate(
  userId: string,
  sessionId: string,
): Promise<CancelSeriesSeatDateResult> {
  const cutoffHours = await getSettingNumber("CANCELLATION_CUTOFF_HOURS");

  const client = await pool.connect();
  let shouldNotifyWaitlist = false;
  try {
    await client.query("BEGIN");

    const reservationRow = await client.query<{ id: string; pass_id: string }>(
      `SELECT id, pass_id FROM seat_reservations WHERE session_id = $1 AND user_id = $2 FOR UPDATE`,
      [sessionId, userId],
    );
    if (reservationRow.rowCount === 0) {
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

    // Same policy as cancelBooking: canceling is always allowed, but within
    // the cutoff the pass for THIS date is forfeited instead of refunded —
    // only this one session's pass, not the seat's other reserved dates.
    const refund = isCancellable(new Date(startTime), cutoffHours);

    const countRow = await client.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE session_id = $1 AND status = 'Used'`,
      [sessionId],
    );
    shouldNotifyWaitlist = Number(countRow.rows[0].count) >= maxCapacity;

    if (refund) {
      await client.query(`UPDATE passes SET status = 'Available', session_id = NULL WHERE id = $1`, [
        reservationRow.rows[0].pass_id,
      ]);
    } else {
      await client.query(`UPDATE passes SET status = 'Forfeited' WHERE id = $1`, [reservationRow.rows[0].pass_id]);
    }
    await client.query(`DELETE FROM seat_reservations WHERE id = $1`, [reservationRow.rows[0].id]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (shouldNotifyWaitlist) {
    await broadcastWaitlistOpening(sessionId);
  }

  return { ok: true };
}

/**
 * Cancels every not-yet-canceled session on `seriesId` matching the date
 * filter (or everything still in the future, if `fromDate` is null) — the
 * series analogue of recurrence/actions.ts's cancelFutureSessionsForRule.
 * Unlike a recurring rule, a series is never regenerated, so there's no
 * "end the rule" step here — cancellation is just marking sessions Canceled.
 */
async function cancelFutureSessionsForSeries(seriesId: string, fromDate: Date | null): Promise<void> {
  const result = await pool.query<{ id: string; start_time: Date; status: string }>(
    `SELECT id, start_time, status FROM sessions WHERE series_id = $1`,
    [seriesId],
  );
  const sessions: CancelableSession[] = result.rows.map((row) => ({
    id: row.id,
    startTime: new Date(row.start_time),
    status: row.status,
  }));

  for (const id of selectSessionIdsToCancel(sessions, fromDate)) {
    await releaseAllBookingsForSession(id);
  }
}

/**
 * Cancels this occurrence and every later occurrence on the same series
 * (start_time >= this one) — earlier still-upcoming occurrences on the same
 * series are untouched, same semantics as the recurring-rule version.
 */
export async function cancelSeriesThisAndFuture(sessionId: string): Promise<void> {
  const result = await pool.query<{ series_id: string | null; start_time: Date }>(
    `SELECT series_id, start_time FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (result.rowCount === 0) return;
  const { series_id: seriesId, start_time: startTime } = result.rows[0];

  if (!seriesId) {
    await releaseAllBookingsForSession(sessionId);
    return;
  }

  await cancelFutureSessionsForSeries(seriesId, new Date(startTime));
}

export async function cancelEntireSeriesById(seriesId: string): Promise<void> {
  await cancelFutureSessionsForSeries(seriesId, null);
}

/** Looks up the session's series before delegating to cancelEntireSeriesById — the entry point for a per-session "cancel the entire series" button. */
export async function cancelEntireSeriesForSession(sessionId: string): Promise<void> {
  const result = await pool.query<{ series_id: string | null }>(
    `SELECT series_id FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (result.rowCount === 0) return;
  const seriesId = result.rows[0].series_id;

  if (!seriesId) {
    await releaseAllBookingsForSession(sessionId);
    return;
  }

  await cancelEntireSeriesById(seriesId);
}
