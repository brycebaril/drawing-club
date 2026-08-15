import { pool } from "@/lib/db/pool";
import { releaseAllBookingsForSession } from "@/lib/booking/actions";

export interface CancelableSession {
  id: string;
  startTime: Date;
  status: string;
}

/**
 * Pure selection logic for the this-and-future vs. entire-series distinction:
 * `fromDate` set means "this occurrence and every later one" (start_time >= fromDate);
 * `fromDate` null means "every still-upcoming occurrence" (start_time > now), regardless
 * of which occurrence was clicked. Either way, only `Scheduled` sessions are eligible —
 * already-canceled or past sessions are never touched.
 */
export function selectSessionIdsToCancel(
  sessions: CancelableSession[],
  fromDate: Date | null,
  now: Date = new Date(),
): string[] {
  return sessions
    .filter((s) => s.status === "Scheduled")
    .filter((s) => (fromDate ? s.startTime >= fromDate : s.startTime > now))
    .map((s) => s.id);
}

/**
 * Cancels every not-yet-canceled session on `ruleId` matching the date
 * filter (or everything still in the future, if `fromDate` is null) —
 * shared by the two cancellation entry points: a specific clicked
 * occurrence (this-and-future / entire-series) and the recurring-rules
 * list page's standalone "cancel series" action.
 */
async function cancelFutureSessionsForRule(ruleId: string, fromDate: Date | null): Promise<void> {
  const result = await pool.query<{ id: string; start_time: Date; status: string }>(
    `SELECT id, start_time, status FROM sessions WHERE recurrence_rule_id = $1`,
    [ruleId],
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

/** Ends a rule so rollforward stops generating past `cutoffDate` (inclusive of the day before). */
async function endRuleBefore(ruleId: string, cutoffDate: Date): Promise<void> {
  const dayBefore = new Date(cutoffDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  await pool.query(`UPDATE recurrence_rules SET end_date = $1 WHERE id = $2`, [dayBefore, ruleId]);
}

/**
 * Cancels this occurrence and every later occurrence on the same rule
 * (start_time >= this one) — occurrences *before* the clicked one that are
 * still upcoming are untouched (Design Doc's three-way pattern, Phase 5 plan).
 */
export async function cancelThisAndFutureOccurrences(sessionId: string): Promise<void> {
  const result = await pool.query<{ recurrence_rule_id: string | null; start_time: Date }>(
    `SELECT recurrence_rule_id, start_time FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (result.rowCount === 0) return;
  const { recurrence_rule_id: ruleId, start_time: startTime } = result.rows[0];

  if (!ruleId) {
    await releaseAllBookingsForSession(sessionId);
    return;
  }

  await cancelFutureSessionsForRule(ruleId, new Date(startTime));
  await endRuleBefore(ruleId, new Date(startTime));
}

/**
 * Cancels every still-upcoming occurrence on the rule, regardless of which
 * one was clicked (unlike this-and-future, this can also cancel occurrences
 * chronologically *before* the clicked one, if they're still in the future).
 * Past occurrences are never touched.
 */
export async function cancelEntireSeriesByRuleId(ruleId: string): Promise<void> {
  await cancelFutureSessionsForRule(ruleId, null);
  await endRuleBefore(ruleId, new Date());
}

export async function cancelEntireSeries(sessionId: string): Promise<void> {
  const result = await pool.query<{ recurrence_rule_id: string | null }>(
    `SELECT recurrence_rule_id FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (result.rowCount === 0) return;
  const ruleId = result.rows[0].recurrence_rule_id;

  if (!ruleId) {
    await releaseAllBookingsForSession(sessionId);
    return;
  }

  await cancelEntireSeriesByRuleId(ruleId);
}
