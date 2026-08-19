import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";
import { loadTicketSpendByCustomer, weightedAverageTicketPrice } from "./ticketPricing";

interface LegacyBalanceRow {
  id: number;
  numTickets: number;
}

/**
 * Converts session_attendees.numTickets (a single running balance, no
 * per-purchase price/date lineage) into individual passes rows, each
 * carrying its own effective_price — docs/MigrationPlan.md Decision 1
 * (docs/LegacyDataAnalysis.md): weighted-average price paid per ticket
 * across the user's full purchase history, not FIFO/LIFO or a flat $0.
 *
 * Deliberately does NOT synthesize passes for owned_passes rows carrying
 * free_studio_seat (role-linked "free unlimited attendance") — that legacy
 * concept has no equivalent in this app's pass economy at all (membership
 * here affects pricing/booking-window, never grants unlimited free seats).
 * It's the same shape as the not-yet-built "volunteers get a free pass per
 * week, capped at a configurable wallet limit" feature the org raised
 * during migration planning — that feature, once built, is the intended
 * real replacement, not something for this script to approximate with an
 * arbitrary synthesized pass count.
 */
export async function migratePasses(client: PoolClient): Promise<MigrationReport> {
  const report = emptyReport("passes (from numTickets balance)");

  const [balances, spend] = await Promise.all([
    legacyQuery<(LegacyBalanceRow & RowDataPacket)[]>(
      `SELECT id, numTickets FROM session_attendees WHERE numTickets > 0`,
    ),
    loadTicketSpendByCustomer(),
  ]);

  for (const balance of balances) {
    const userId = legacyAttendeeIdToNewId.get(balance.id);
    if (!userId) {
      report.skipped += 1;
      report.warnings.push(`session_attendees.id ${balance.id}: no migrated user — skipped.`);
      continue;
    }

    const averagePrice = weightedAverageTicketPrice(spend, balance.id);
    const effectivePrice = averagePrice ?? "0.00";
    if (averagePrice === null) {
      report.warnings.push(
        `session_attendees.id ${balance.id}: numTickets=${balance.numTickets} but no ticket-purchase history found — migrated at $0.00 effective_price (likely an admin-granted balance).`,
      );
    }

    for (let i = 0; i < balance.numTickets; i += 1) {
      await client.query(
        `INSERT INTO passes (owner_id, status, is_transferable, effective_price)
         VALUES ($1, 'Available', false, $2)`,
        [userId, effectivePrice],
      );
      report.migrated += 1;
    }
  }

  return report;
}
