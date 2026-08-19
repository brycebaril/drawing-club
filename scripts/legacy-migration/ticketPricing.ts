import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";

interface LegacyTicketSpendRow {
  customerId: number;
  totalPrice: string;
  totalTickets: number;
}

export type TicketSpendByCustomer = Map<number, { totalPrice: string; totalTickets: number }>;

/**
 * Shared by both the numTickets-balance conversion (passes.ts) and the
 * future-dated-registration conversion (attendanceHistory.ts) — both need
 * the same weighted-average price paid per ticket across a user's full
 * purchase history (docs/MigrationPlan.md Decision 1).
 */
export async function loadTicketSpendByCustomer(): Promise<TicketSpendByCustomer> {
  const spend = await legacyQuery<(LegacyTicketSpendRow & RowDataPacket)[]>(
    `SELECT so.customerId, SUM(soc.price) AS totalPrice, SUM(
       CASE soc.sku WHEN 1 THEN 1 WHEN 101 THEN 1 WHEN 5 THEN 5 WHEN 105 THEN 5 WHEN 7 THEN 10 ELSE 0 END
     ) AS totalTickets
     FROM store_order_components soc
     JOIN store_orders so ON so.invoiceId = soc.invoiceId
     WHERE so.status = 10 AND soc.sku IN (1, 101, 5, 105, 7)
     GROUP BY so.customerId`,
  );
  return new Map(spend.map((row) => [row.customerId, row]));
}

export function weightedAverageTicketPrice(spend: TicketSpendByCustomer, customerId: number): string | null {
  const history = spend.get(customerId);
  if (!history || Number(history.totalTickets) === 0) return null;
  return (Number(history.totalPrice) / Number(history.totalTickets)).toFixed(2);
}
