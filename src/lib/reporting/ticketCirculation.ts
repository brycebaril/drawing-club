import { getPassesReport, type PassesReportRow } from "./passesReport";

export interface TicketCirculationStats {
  outstandingCount: number;
  transferableCount: number;
  /** null rather than 0 when there are no outstanding tickets at all. */
  avgCostBasis: number | null;
  totalLiability: number;
}

/** Pure reshape, split out for unit testing separate from the DB round-trip. */
export function summarizeTicketCirculation(
  totals: PassesReportRow | undefined,
  transferable: PassesReportRow | undefined,
): TicketCirculationStats {
  const outstandingCount = totals?.count ?? 0;
  const totalLiability = Number(totals?.total_value ?? 0);
  return {
    outstandingCount,
    transferableCount: transferable?.count ?? 0,
    avgCostBasis: outstandingCount > 0 ? totalLiability / outstandingCount : null,
    totalLiability,
  };
}

/**
 * "Outstanding" = not yet spent (Available or Assigned — the other three
 * statuses, Used/Forfeited/Revoked, are terminal). Reuses the existing
 * parameterized passesReport dataset with no groupBy/dateRange, which both
 * cleanly no-op to return one aggregate row.
 */
export async function getTicketCirculationStats(): Promise<TicketCirculationStats> {
  const [totals, transferable] = await Promise.all([
    getPassesReport({ filters: { status: ["Available", "Assigned"] } }),
    getPassesReport({ filters: { status: ["Available", "Assigned"], isTransferable: true } }),
  ]);
  return summarizeTicketCirculation(totals[0], transferable[0]);
}
