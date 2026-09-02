import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import type { UserAuthContext } from "@/lib/auth/roles";

export interface CheckInSessionRow {
  sessionType: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  status: string;
  maxCapacity: number;
  hostUsername: string | null;
  hostDisplayName: string | null;
  seriesId: string | null;
}

export interface CheckInAccessContext extends UserAuthContext {
  /** The session row this access check already fetched — getCheckInRoster reuses it instead of a second query. */
  session: CheckInSessionRow;
}

/**
 * SecurityDocument.md §3: the RBAC matrix is route-level only — VOL_HOST is
 * additionally scoped to sessions they're assigned to host, which Proxy
 * can't express. Shared by every check-in Server Function — both the
 * page-render path and the ones called directly from SessionRosterCard's
 * client-side poll/toggle (an RPC call, not covered by Proxy's /ops/* route
 * rule the way a page render is, so it has to be re-checked here too).
 * Returns null on any failure rather than redirecting/notFound() itself —
 * callers decide how to surface that (a page calls notFound(); a Server
 * Function returns an error result).
 *
 * Selects the full display row (not just host_user_id) so getCheckInRoster
 * — which needs both the access check and this same session's display
 * fields on every load and every 10s poll — doesn't pay a second round
 * trip against the same row right after this one.
 */
export async function requireCheckInAccess(sessionId: string): Promise<CheckInAccessContext | null> {
  const ctx = await requireOpsRole(["VOL_HOST", "VOL_MBR"]);
  if (!ctx) return null;

  const sessionResult = await pool.query<{
    host_user_id: string | null;
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
    `SELECT s.host_user_id, s.session_type, s.description, s.start_time, s.end_time, s.status, s.max_capacity,
            u.username AS host_username, u.display_name AS host_display_name, s.series_id
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.id = $1`,
    [sessionId],
  );
  if (sessionResult.rowCount === 0) return null;
  const row = sessionResult.rows[0];

  const isPrivileged = ctx.roles.includes("ADMIN") || ctx.roles.includes("VOL_MBR");
  const isAssignedHost = ctx.roles.includes("VOL_HOST") && row.host_user_id === ctx.id;
  if (!isPrivileged && !isAssignedHost) return null;

  return {
    ...ctx,
    session: {
      sessionType: row.session_type,
      description: row.description,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      maxCapacity: row.max_capacity,
      hostUsername: row.host_username,
      hostDisplayName: row.host_display_name,
      seriesId: row.series_id,
    },
  };
}
