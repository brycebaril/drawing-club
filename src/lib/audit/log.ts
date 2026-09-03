import type { Pool, PoolClient } from "pg";
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
 *
 * Optional `queryable`: pass the transaction's own `PoolClient` (instead of
 * relying on the default shared `pool`) when the audit entry must commit or
 * roll back atomically with other writes in that transaction — src/app/api/
 * webhooks/stripe/route.ts does this, since writing the log *after* the
 * webhook's transaction already committed meant a failure there both
 * pointlessly 500'd an already-fulfilled webhook back to Stripe for retry,
 * and silently lost the audit entry for good (the retry's idempotency check
 * short-circuits before ever reaching this call again).
 */
export async function writeAuditLog(entry: AuditLogEntry, queryable: Pool | PoolClient = pool): Promise<void> {
  await queryable.query(
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
