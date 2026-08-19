import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";
import { legacySessionIdToNew } from "./sessions";
import { legacyInvoiceIdToTransactionId } from "./transactions";

interface LegacyRegistrationLogRow {
  id: number;
  whenx: string; // dateStrings: true — see mysqlSource.ts
  what: number;
  who: number;
  whichSession: number | null;
  whom: number | null;
  howMany: number;
  whichOrder: number | null;
  whichPass: number | null;
  comment: string | null;
}

// Full vocabulary from docs/LegacyDataAnalysis.md's Appendix. 0/1
// (logged in/out) are excluded by the query below — ~60% of all rows and
// not useful for a customer-service lookup.
const EVENT_LABELS: Record<number, string> = {
  2: "Self-registered a seat",
  3: "Self-cancelled a seat",
  4: "Admin registered a seat for another member",
  5: "Admin cancelled a seat for another member",
  6: "Created an order",
  7: "Paid for an order",
  8: "Received tickets or a pass",
  9: "Notified that a pass expired",
  10: "Created an account",
  11: "Changed account password",
  12: "Admin invalidated a pass",
  13: "Self seat refunded",
  14: "Admin-initiated seat refund",
  15: "Renewed an existing pass",
  16: "Set session manager",
  17: "Attempted login while suspended",
  18: "Scheduled a session manager (date range)",
};

/**
 * Migrates registration_logs (docs/LegacyDataAnalysis.md's Appendix has the
 * full `what` vocabulary) into legacy_registration_logs, a read-only
 * historical trail for customer-service lookups — not this app's own
 * system_audit_logs, which only ever records actions taken through this
 * app. Must run after migrateUsers/migrateSessions/migrateTransactions in
 * the same orchestrator pass: actor/target/session/transaction linkage all
 * resolve through those steps' in-memory legacy-id maps, since sessions and
 * orders never got a persisted legacy_id column of their own.
 */
export async function migrateRegistrationLogs(client: PoolClient): Promise<MigrationReport> {
  const report = emptyReport("legacy_registration_logs");

  const rows = await legacyQuery<(LegacyRegistrationLogRow & RowDataPacket)[]>(
    `SELECT id, whenx, what, who, whichSession, whom, howMany, whichOrder, whichPass, comment
     FROM registration_logs
     WHERE what NOT IN (0, 1)
     ORDER BY id`,
  );

  for (const row of rows) {
    const actorUserId = legacyAttendeeIdToNewId.get(row.who) ?? null;
    if (!actorUserId) {
      report.warnings.push(`registration_logs.id ${row.id}: who ${row.who} has no migrated user — actor left unset.`);
    }
    const targetUserId = row.whom !== null ? (legacyAttendeeIdToNewId.get(row.whom) ?? null) : null;
    const sessionId = row.whichSession !== null ? (legacySessionIdToNew.get(row.whichSession)?.id ?? null) : null;
    const transactionId =
      row.whichOrder !== null ? (legacyInvoiceIdToTransactionId.get(row.whichOrder) ?? null) : null;

    await client.query(
      `INSERT INTO legacy_registration_logs
         (legacy_id, occurred_at, event_code, event_label, actor_user_id, target_user_id,
          session_id, transaction_id, legacy_pass_id, how_many, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.whenx,
        row.what,
        EVENT_LABELS[row.what] ?? `Unknown event (code ${row.what})`,
        actorUserId,
        targetUserId,
        sessionId,
        transactionId,
        row.whichPass,
        row.howMany,
        row.comment,
      ],
    );
    report.migrated += 1;
  }

  return report;
}
