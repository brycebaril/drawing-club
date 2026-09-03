"use server";

import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { requireCheckInAccess } from "./access";
import { displayModelNames } from "@/lib/models/modelName";

export interface CheckInSessionSummary {
  id: string;
  sessionType: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  status: string;
  maxCapacity: number;
  hostUsername: string | null;
  hostDisplayName: string | null;
  isSeries: boolean;
}

export interface RosterRow {
  id: string;
  rowType: "pass" | "seat";
  userId: string;
  username: string;
  displayName: string | null;
  seatNumber: number | null;
  checkedIn: boolean;
  isMember: boolean;
  isFirstTimer: boolean;
}

export interface CheckInNote {
  id: string;
  content: string;
  createdAt: Date;
  authorUsername: string;
  authorDisplayName: string | null;
  baseRole: string;
  volunteerRoles: string[];
}

export interface CheckInRoster {
  session: CheckInSessionSummary;
  modelNames: string | null;
  roster: RosterRow[];
  notes: CheckInNote[];
}

/**
 * The single source of a session's check-in view — called both from the
 * page render (Server Component, for the initial SSR payload) and directly
 * from SessionRosterCard's client-side poll (a Server Function RPC call).
 * Re-checks access itself via requireCheckInAccess (see that file's own
 * comment on why the RPC path needs it independently of Proxy).
 */
export async function getCheckInRoster(sessionId: string): Promise<CheckInRoster | null> {
  const ctx = await requireCheckInAccess(sessionId);
  if (!ctx) return null;

  // requireCheckInAccess already fetched this session's display row as
  // part of its own access check — no need to query it again here.
  const sessionRow = ctx.session;
  const isSeries = sessionRow.seriesId !== null;

  const [modelResult, rosterBaseResult, notesResult] = await Promise.all([
    // string_agg, not LIMIT 1 — a session can have more than one model
    // assigned (src/app/ops/model-booking's own assign/unassign UI already
    // supports it, and the schedule page's own tooltip already aggregates
    // every assigned model this same way), and check-in previously silently
    // dropped every model past the first from view.
    pool.query<{ names: string | null }>(
      `SELECT string_agg(m.name, ', ' ORDER BY m.name) AS names FROM session_model_mapping smm JOIN models m ON m.id = smm.model_id WHERE smm.session_id = $1`,
      [sessionId],
    ),
    isSeries
      ? pool.query<{
          id: string;
          user_id: string;
          username: string;
          display_name: string | null;
          seat_number: number | null;
          checked_in: boolean;
        }>(
          `SELECT sr.id, sr.user_id, u.username, u.display_name, sr.seat_number, sr.checked_in
           FROM seat_reservations sr
           JOIN users u ON u.id = sr.user_id
           WHERE sr.session_id = $1
           ORDER BY sr.seat_number`,
          [sessionId],
        )
      : pool.query<{
          id: string;
          user_id: string;
          username: string;
          display_name: string | null;
          seat_number: number | null;
          checked_in: boolean;
        }>(
          `SELECT p.id, p.owner_id AS user_id, u.username, u.display_name, NULL::integer AS seat_number, p.checked_in
           FROM passes p
           JOIN users u ON u.id = p.owner_id
           WHERE p.session_id = $1 AND p.status = 'Used'
           ORDER BY u.username`,
          [sessionId],
        ),
    pool.query<{
      id: string;
      content: string;
      created_at: Date;
      author_username: string;
      author_display_name: string | null;
      base_role: string;
      volunteer_roles: string[];
    }>(
      `SELECT sn.id, sn.content, sn.created_at, u.username AS author_username, u.display_name AS author_display_name, u.base_role,
              COALESCE(array_agg(vr.role::text) FILTER (WHERE vr.role IS NOT NULL), '{}') AS volunteer_roles
       FROM session_notes sn
       JOIN users u ON u.id = sn.author_user_id
       LEFT JOIN volunteer_roles vr ON vr.user_id = u.id
       WHERE sn.session_id = $1
       GROUP BY sn.id, sn.content, sn.created_at, u.username, u.display_name, u.base_role
       ORDER BY sn.created_at DESC`,
      [sessionId],
    ),
  ]);

  const userIds = rosterBaseResult.rows.map((r) => r.user_id);

  // Member: same membership_expires_at > now() check roles.ts's MBR
  // derivation uses (inlined here — this row shape differs from UserRow, so
  // not importing isMemberTier directly).
  // First-timer: no PRIOR checked_in = true row for that user anywhere —
  // passes and seat_reservations cover real Phase 8+ bookings, but a
  // migrated member's actual attendance history lives in
  // legacy_attendance_history instead (see CLAUDE.md's legacy migration
  // notes), so skipping that table would wrongly badge every migrated
  // member as a first-timer. session_id IS DISTINCT FROM (not !=) so a
  // legacy row with a NULL session_id — the FK is onDelete: SET NULL — still
  // counts as prior attendance instead of being silently excluded.
  const [memberResult, attendedBeforeResult] =
    userIds.length > 0
      ? await Promise.all([
          pool.query<{ id: string }>(
            `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND membership_expires_at > now()`,
            [userIds],
          ),
          pool.query<{ user_id: string }>(
            `SELECT DISTINCT user_id FROM (
               SELECT owner_id AS user_id FROM passes
               WHERE owner_id = ANY($1::uuid[]) AND checked_in = true AND session_id IS DISTINCT FROM $2
               UNION ALL
               SELECT user_id FROM seat_reservations
               WHERE user_id = ANY($1::uuid[]) AND checked_in = true AND session_id IS DISTINCT FROM $2
               UNION ALL
               SELECT user_id FROM legacy_attendance_history
               WHERE user_id = ANY($1::uuid[]) AND checked_in = true AND session_id IS DISTINCT FROM $2
             ) attended`,
            [userIds, sessionId],
          ),
        ])
      : [{ rows: [] as { id: string }[] }, { rows: [] as { user_id: string }[] }];

  const memberIds = new Set(memberResult.rows.map((r) => r.id));
  const attendedBeforeIds = new Set(attendedBeforeResult.rows.map((r) => r.user_id));

  const roster: RosterRow[] = rosterBaseResult.rows.map((r) => ({
    id: r.id,
    rowType: isSeries ? "seat" : "pass",
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    seatNumber: r.seat_number,
    checkedIn: r.checked_in,
    isMember: memberIds.has(r.user_id),
    isFirstTimer: !attendedBeforeIds.has(r.user_id),
  }));

  return {
    session: {
      id: sessionId,
      sessionType: sessionRow.sessionType,
      description: sessionRow.description,
      startTime: sessionRow.startTime,
      endTime: sessionRow.endTime,
      status: sessionRow.status,
      maxCapacity: sessionRow.maxCapacity,
      hostUsername: sessionRow.hostUsername,
      hostDisplayName: sessionRow.hostDisplayName,
      isSeries,
    },
    modelNames: displayModelNames(modelResult.rows[0]?.names ?? null, ctx.roles),
    roster,
    notes: notesResult.rows.map((n) => ({
      id: n.id,
      content: n.content,
      createdAt: n.created_at,
      authorUsername: n.author_username,
      authorDisplayName: n.author_display_name,
      baseRole: n.base_role,
      volunteerRoles: n.volunteer_roles,
    })),
  };
}

export type UpcomingCheckInSession = CheckInSessionSummary;

/**
 * The /ops/check-in overview's session list — a rolling 7-day window,
 * host-scoped: a VOL_HOST who isn't also VOL_MBR/ADMIN only sees sessions
 * they're the assigned host of; VOL_MBR/ADMIN see every scheduled session
 * in the window.
 */
export async function getUpcomingCheckInSessions(): Promise<UpcomingCheckInSession[] | null> {
  const ctx = await requireOpsRole(["VOL_HOST", "VOL_MBR"]);
  if (!ctx) return null;

  const isPrivileged = ctx.roles.includes("ADMIN") || ctx.roles.includes("VOL_MBR");

  const result = await pool.query<{
    id: string;
    session_type: string;
    description: string | null;
    start_time: Date;
    end_time: Date;
    status: string;
    max_capacity: number;
    host_username: string | null;
    host_display_name: string | null;
    series_id: string | null;
  }>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.status, s.max_capacity,
            u.username AS host_username, u.display_name AS host_display_name, s.series_id
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.status = 'Scheduled' AND s.start_time >= now() AND s.start_time < now() + interval '7 days'
       ${isPrivileged ? "" : "AND s.host_user_id = $1"}
     ORDER BY s.start_time ASC`,
    isPrivileged ? [] : [ctx.id],
  );

  return result.rows.map((row) => ({
    id: row.id,
    sessionType: row.session_type,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    maxCapacity: row.max_capacity,
    hostUsername: row.host_username,
    hostDisplayName: row.host_display_name,
    isSeries: row.series_id !== null,
  }));
}
