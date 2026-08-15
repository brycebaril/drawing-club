import { pool } from "@/lib/db/pool";

export interface AuditLogEntry {
  actorId: string;
  actionType: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Single write path for System_Audit_Logs (Design Doc §13, §10). Every
 * admin/volunteer mutation calls this instead of inserting inline, so no
 * privileged action can accidentally skip logging and the action_type/
 * metadata shape stays consistent across call sites
 * (docs/SecurityDocument.md §9).
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO system_audit_logs (actor_id, action_type, target_user_id, metadata)
     VALUES ($1, $2, $3, $4)`,
    [
      entry.actorId,
      entry.actionType,
      entry.targetUserId ?? null,
      // node-postgres doesn't auto-serialize objects for jsonb columns.
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ],
  );
}
