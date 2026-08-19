import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";
import { legacySessionIdToNew } from "./sessions";
import { loadTicketSpendByCustomer, weightedAverageTicketPrice } from "./ticketPricing";

interface LegacySeatRegistrationRow {
  id: number;
  session: number;
  attendeeId: number;
  registeredById: number;
  passId: number | null;
  attended: number;
}

/**
 * Splits seat_registrations by the migrated session's start_time relative
 * to cutoverDate (docs/MigrationPlan.md §4): a past-dated session's
 * registrations become read-only legacy_attendance_history rows; a
 * still-future session's registrations become real, spendable/spent
 * passes rows, since those represent live bookings a member is still owed.
 *
 * cutoverDate must be computed at actual cutover run time, never fixed
 * during planning/rehearsal — see main()'s --cutover-date flag, which only
 * exists to reproduce a fixed split during rehearsal against a stale dump.
 */
export async function migrateAttendanceHistory(
  client: PoolClient,
  cutoverDate: Date,
): Promise<MigrationReport> {
  const report = emptyReport("legacy_attendance_history + future registrations");

  const [registrations, spend] = await Promise.all([
    legacyQuery<(LegacySeatRegistrationRow & RowDataPacket)[]>(
      `SELECT id, session, attendeeId, registeredById, passId, attended FROM seat_registrations`,
    ),
    loadTicketSpendByCustomer(),
  ]);

  for (const row of registrations) {
    const session = legacySessionIdToNew.get(row.session);
    if (!session) {
      report.skipped += 1;
      report.warnings.push(`seat_registrations.id ${row.id}: session ${row.session} was not migrated — skipped.`);
      continue;
    }
    const userId = legacyAttendeeIdToNewId.get(row.attendeeId);
    if (!userId) {
      report.skipped += 1;
      report.warnings.push(`seat_registrations.id ${row.id}: attendeeId ${row.attendeeId} has no migrated user — skipped.`);
      continue;
    }

    const isFuture = session.startTime >= cutoverDate;
    const fundedBy = row.passId === null ? "ticket_balance" : "membership";

    if (!isFuture) {
      const registeredByUserId = legacyAttendeeIdToNewId.get(row.registeredById) ?? null;
      await client.query(
        `INSERT INTO legacy_attendance_history
           (legacy_registration_id, session_id, user_id, registered_by_user_id, checked_in, funded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [String(row.id), session.id, userId, registeredByUserId, row.attended === 1, fundedBy],
      );
    } else {
      const effectivePrice =
        fundedBy === "membership" ? "0.00" : (weightedAverageTicketPrice(spend, row.attendeeId) ?? "0.00");
      // Membership-funded seats have a real, deliberate $0 per-seat charge
      // (Exact). A ticket_balance-funded seat's price is still a weighted
      // average standing in for an unrecoverable exact historical price —
      // same "Estimated" reasoning as passes.ts's balance conversion, just
      // not given that function's full per-batch free/paid reconstruction
      // (a future booking isn't traceable to a specific historical grant the
      // way a current wallet balance's FIFO composition is).
      const costBasisSource = fundedBy === "membership" ? "Exact" : "Estimated";
      await client.query(
        `INSERT INTO passes (owner_id, session_id, checked_in, status, is_transferable, effective_price, cost_basis_source)
         VALUES ($1, $2, $3, 'Assigned', false, $4, $5)`,
        [userId, session.id, row.attended === 1, effectivePrice, costBasisSource],
      );
    }
    report.migrated += 1;
  }

  return report;
}
