import { pool } from "@/lib/db/pool";

export interface WeeklyAttendanceRow {
  week_start: Date;
  sessions_run: number;
  total_bookings: number;
  checked_in_bookings: number;
}

export interface WeeklyAttendanceSummary {
  weekStart: Date;
  sessionsRun: number;
  totalBookings: number;
  checkedInBookings: number;
  /** A booking that was never cancelled but never checked in either — the
   * ticket was still spent (booking already flips passes.status to 'Used'
   * up front; check-in never touches it), so this counts real lost
   * capacity, not just an administrative gap. */
  noShows: number;
  /** null rather than 0 when a week had no bookings at all — 0% and "no data" are different things. */
  attendanceRate: number | null;
}

export interface AttendanceStats {
  trend: WeeklyAttendanceSummary[];
  totalNoShows: number;
  /** null when the whole trailing window had no bookings at all. */
  noShowRate: number | null;
}

/** Pure rollup, split out for unit testing separate from the DB round-trip. */
export function summarizeAttendance(rows: WeeklyAttendanceRow[]): WeeklyAttendanceSummary[] {
  return rows.map((row) => ({
    weekStart: row.week_start,
    sessionsRun: row.sessions_run,
    totalBookings: row.total_bookings,
    checkedInBookings: row.checked_in_bookings,
    noShows: row.total_bookings - row.checked_in_bookings,
    attendanceRate: row.total_bookings > 0 ? row.checked_in_bookings / row.total_bookings : null,
  }));
}

/** Top-level rollup across the whole trend — the "top-level stat" a
 * dashboard card or an API consumer wants without summing weeks itself. */
export function summarizeNoShows(trend: WeeklyAttendanceSummary[]): Pick<AttendanceStats, "totalNoShows" | "noShowRate"> {
  const totalNoShows = trend.reduce((sum, week) => sum + week.noShows, 0);
  const totalBookings = trend.reduce((sum, week) => sum + week.totalBookings, 0);
  return {
    totalNoShows,
    noShowRate: totalBookings > 0 ? totalNoShows / totalBookings : null,
  };
}

/**
 * "Booking" here unifies passes (generic sessions) and seat_reservations
 * (series sessions) — same union check-in's roster query already does per
 * session, applied here across all sessions in the trailing window.
 */
export async function getAttendanceTrend(): Promise<AttendanceStats> {
  const result = await pool.query<WeeklyAttendanceRow>(
    // p.status = 'Used' matches every other consumer of this same concept
    // (check-in's roster query, reporting/flags.ts's capacity check) — a
    // 'Forfeited' pass (a late cancellation that never resulted in
    // attendance) keeps session_id set on purpose, but shouldn't count as
    // a booking here any more than it does anywhere else.
    `WITH bookings AS (
       SELECT p.session_id, p.checked_in FROM passes p WHERE p.session_id IS NOT NULL AND p.status = 'Used'
       UNION ALL
       SELECT sr.session_id, sr.checked_in FROM seat_reservations sr
     ),
     weekly AS (
       SELECT date_trunc('week', s.start_time) AS week_start, s.id AS session_id, b.checked_in
       FROM sessions s
       JOIN bookings b ON b.session_id = s.id
       WHERE s.status != 'Canceled' AND s.start_time < now() AND s.start_time >= now() - interval '12 weeks'
     )
     SELECT week_start,
            count(DISTINCT session_id)::int AS sessions_run,
            count(*)::int AS total_bookings,
            count(*) FILTER (WHERE checked_in)::int AS checked_in_bookings
     FROM weekly
     GROUP BY week_start
     ORDER BY week_start`,
  );
  const trend = summarizeAttendance(result.rows);
  return { trend, ...summarizeNoShows(trend) };
}
