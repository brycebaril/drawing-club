import { pool } from "@/lib/db/pool";

export interface RevenueRow {
  week_start: Date;
  item_type: string;
  count: number;
  total: string;
}

export interface WeeklyRevenueSummary {
  weekStart: Date;
  byItemType: Record<string, { count: number; total: number }>;
  totalRevenue: number;
}

/** Pure reshape (flat weekly/item_type rows -> one row per week), unit-tested separately from the DB round-trip. */
export function groupRevenueByWeek(rows: RevenueRow[]): WeeklyRevenueSummary[] {
  const byWeek = new Map<number, WeeklyRevenueSummary>();

  for (const row of rows) {
    const key = new Date(row.week_start).getTime();
    let entry = byWeek.get(key);
    if (!entry) {
      entry = { weekStart: new Date(row.week_start), byItemType: {}, totalRevenue: 0 };
      byWeek.set(key, entry);
    }
    const total = Number(row.total);
    entry.byItemType[row.item_type] = { count: row.count, total };
    entry.totalRevenue += total;
  }

  return [...byWeek.values()].sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
}

/** Reuses /ops/financials's aggregation-query shape (transactions grouped by item_type), bucketed by week. */
export async function getRevenueTrend(): Promise<WeeklyRevenueSummary[]> {
  const result = await pool.query<RevenueRow>(
    `SELECT date_trunc('week', created_at) AS week_start, item_type, count(*)::int AS count, sum(amount_paid) AS total
     FROM transactions
     WHERE charge_status = 'Succeeded' AND created_at >= now() - interval '12 weeks'
     GROUP BY week_start, item_type
     ORDER BY week_start, item_type`,
  );
  return groupRevenueByWeek(result.rows);
}
