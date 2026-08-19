import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";
import {
  loadTicketGrantEventsByCustomer,
  loadTicketSpendByCustomer,
  resolveTicketBalanceBatches,
  weightedAverageTicketPrice,
} from "./ticketPricing";

interface LegacyBalanceRow {
  id: number;
  numTickets: number;
}

/**
 * Converts session_attendees.numTickets (a single running balance, no
 * per-purchase price/date lineage) into individual passes rows, each
 * carrying its own effective_price. Originally a single weighted-average
 * price applied to a user's entire balance (docs/MigrationPlan.md
 * Decision 1) — replaced 2026-08-19 after a real member (a long-tenured
 * volunteer) reported their whole wallet priced at a nonzero cost basis
 * that should have been $0. The average itself was never wrong (it only
 * ever averaged real purchases), but applying it to *every* unit of a
 * balance — including free volunteer/comp grants — was. Now uses
 * resolveTicketBalanceBatches (ticketPricing.ts) to reconstruct which of
 * the current balance's units are free vs. paid via the registration_logs
 * ledger, per-user, before pricing anything.
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

  const [balances, spend, grantEvents] = await Promise.all([
    legacyQuery<(LegacyBalanceRow & RowDataPacket)[]>(
      `SELECT id, numTickets FROM session_attendees WHERE numTickets > 0`,
    ),
    loadTicketSpendByCustomer(),
    loadTicketGrantEventsByCustomer(),
  ]);

  for (const balance of balances) {
    const userId = legacyAttendeeIdToNewId.get(balance.id);
    if (!userId) {
      report.skipped += 1;
      report.warnings.push(`session_attendees.id ${balance.id}: no migrated user — skipped.`);
      continue;
    }

    const averagePrice = weightedAverageTicketPrice(spend, balance.id);
    const events = grantEvents.get(balance.id) ?? [];
    const batches = resolveTicketBalanceBatches(events, balance.numTickets, averagePrice);

    if (events.length === 0) {
      report.warnings.push(
        `session_attendees.id ${balance.id}: numTickets=${balance.numTickets} but no registration_logs grant history found — priced at $${averagePrice ?? "0.00"} (fallback, likely predates the source data), marked Estimated.`,
      );
    }

    for (const batch of batches) {
      for (let i = 0; i < batch.qty; i += 1) {
        await client.query(
          `INSERT INTO passes (owner_id, status, is_transferable, effective_price, cost_basis_source)
           VALUES ($1, 'Available', false, $2, $3)`,
          [userId, batch.price, batch.costBasisSource],
        );
        report.migrated += 1;
      }
    }
  }

  return report;
}
