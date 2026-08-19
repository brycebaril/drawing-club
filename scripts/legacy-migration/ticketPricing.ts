import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";

export type CostBasisSource = "Exact" | "Estimated";

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

interface LegacyTicketGrantRow {
  who: number;
  whenx: string; // dateStrings: true
  howMany: number;
  comment: string | null;
}

export interface TicketGrantEvent {
  howMany: number;
  isFree: boolean;
}

// registration_logs `what=8` (RECEIVED_TICKETS_OR_PASSES_LOG_EVENT) comments
// for automated/admin free grants — confirmed against the real dump: these
// three patterns cover the entire "free-ish" comment population (volunteer
// weekly free tickets, one-off comps, AGM attendance) with no other
// meaningful variant found. An uncommented row is a real store purchase.
const FREE_GRANT_COMMENT = /free|comp |complimentary/i;

/**
 * Loads every ticket-balance-affecting event (`registration_logs.what=8`)
 * per legacy customer, chronologically ordered — the input to
 * resolveTicketBalanceBatches's FIFO reconstruction below.
 */
export async function loadTicketGrantEventsByCustomer(): Promise<Map<number, TicketGrantEvent[]>> {
  const rows = await legacyQuery<(LegacyTicketGrantRow & RowDataPacket)[]>(
    `SELECT who, whenx, howMany, comment FROM registration_logs WHERE what = 8 ORDER BY who, whenx ASC, id ASC`,
  );
  const map = new Map<number, TicketGrantEvent[]>();
  for (const row of rows) {
    const list = map.get(row.who) ?? [];
    list.push({ howMany: row.howMany, isFree: row.comment !== null && FREE_GRANT_COMMENT.test(row.comment) });
    map.set(row.who, list);
  }
  return map;
}

interface QueueBatch {
  price: string;
  costBasisSource: CostBasisSource;
  qty: number;
}

function removeFromFront(queue: QueueBatch[], amount: number): void {
  let remaining = amount;
  while (remaining > 0 && queue.length > 0) {
    const take = Math.min(queue[0].qty, remaining);
    queue[0].qty -= take;
    remaining -= take;
    if (queue[0].qty === 0) queue.shift();
  }
}

/**
 * Reconstructs the price composition of a user's CURRENT ticket balance.
 * The bug this replaces: applying one blended weighted-average price to
 * every unit of a balance, even units that came from a free volunteer/comp
 * grant rather than a real purchase — real for any long-tenured volunteer
 * (confirmed against real data: 2,341 of the studio's ~31K granted tickets
 * are free-grant, heavily concentrated in a handful of active volunteers'
 * balances).
 *
 * Ordinary booking consumption is never itself logged as a `what=8` row, so
 * there's no way to replay it directly. Instead: `events` gives the full
 * signed grant/deduction history in order; comparing its net total against
 * the known current balance tells us how many of the *oldest* granted units
 * must have been consumed since (FIFO — oldest acquired, spent first, the
 * same assumption this app's own live pass-selection already makes). What's
 * left in the queue after removing that many from the front is the balance's
 * real price composition, batch by batch, instead of one number for
 * everything.
 */
export function resolveTicketBalanceBatches(
  events: TicketGrantEvent[],
  currentBalance: number,
  averagePaidPrice: string | null,
): QueueBatch[] {
  const queue: QueueBatch[] = [];
  for (const event of events) {
    if (event.howMany > 0) {
      queue.push({
        price: event.isFree ? "0.00" : (averagePaidPrice ?? "0.00"),
        // Free is the only case backed by direct evidence (an explicit
        // free/comp comment) — everything else, including a price backed by
        // a real purchase history, is an average standing in for an
        // unrecoverable exact per-ticket price.
        costBasisSource: event.isFree ? "Exact" : "Estimated",
        qty: event.howMany,
      });
    } else if (event.howMany < 0) {
      removeFromFront(queue, -event.howMany);
    }
  }

  const queueTotal = queue.reduce((sum, b) => sum + b.qty, 0);
  if (queueTotal > currentBalance) {
    removeFromFront(queue, queueTotal - currentBalance);
  } else if (queueTotal < currentBalance) {
    // The logged ledger doesn't fully cover the known balance (e.g. grants
    // that predate registration_logs' own history) — fill the shortfall the
    // same way this code already handled a balance with zero known history,
    // explicitly flagged Estimated rather than silently assumed exact.
    queue.push({ price: averagePaidPrice ?? "0.00", costBasisSource: "Estimated", qty: currentBalance - queueTotal });
  }

  return queue.filter((b) => b.qty > 0);
}
