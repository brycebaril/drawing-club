import { pool } from "@/lib/db/pool";

export interface RecentAuditLogRow {
  id: string;
  actor_username: string | null;
  action_type: string;
  target_username: string | null;
  created_at: Date;
}

/** Read-only tail of the same table /admin/audit-logs already queries in full — not a new logging system. */
export async function getRecentAuditLogs(limit = 20): Promise<RecentAuditLogRow[]> {
  const result = await pool.query<RecentAuditLogRow>(
    `SELECT sal.id, actor.username AS actor_username, sal.action_type, target.username AS target_username, sal.created_at
     FROM system_audit_logs sal
     LEFT JOIN users actor ON actor.id = sal.actor_id
     LEFT JOIN users target ON target.id = sal.target_user_id
     ORDER BY sal.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}
