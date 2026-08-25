import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import type { UserAuthContext } from "@/lib/auth/roles";

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
 */
export async function requireCheckInAccess(sessionId: string): Promise<UserAuthContext | null> {
  const ctx = await requireOpsRole(["VOL_HOST", "VOL_MBR"]);
  if (!ctx) return null;

  const sessionRow = await pool.query<{ host_user_id: string | null }>(
    `SELECT host_user_id FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (sessionRow.rowCount === 0) return null;

  const isPrivileged = ctx.roles.includes("ADMIN") || ctx.roles.includes("VOL_MBR");
  const isAssignedHost = ctx.roles.includes("VOL_HOST") && sessionRow.rows[0].host_user_id === ctx.id;
  if (!isPrivileged && !isAssignedHost) return null;

  return ctx;
}
