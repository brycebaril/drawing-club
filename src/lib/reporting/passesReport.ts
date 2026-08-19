import { pool } from "@/lib/db/pool";
import { dateRangeClause, resolveGroupBy, timeBucketExpression, type DateRange, type Granularity } from "./queryFilters";

export const PASS_STATUSES = ["Available", "Assigned", "Used", "Revoked"] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

export const PASS_ORIGINS = ["legacy", "stripe", "batch", "admin_grant"] as const;
export type PassOrigin = (typeof PASS_ORIGINS)[number];

export const COST_BASIS_SOURCES = ["Exact", "Estimated"] as const;
export type CostBasisSource = (typeof COST_BASIS_SOURCES)[number];

export interface PassesReportFilters {
  status?: PassStatus[];
  isTransferable?: boolean;
  ownerRole?: string[];
  costBasisMin?: number;
  costBasisMax?: number;
  origin?: PassOrigin[];
  costBasisSource?: CostBasisSource[];
}

export interface PassesReportParams {
  filters?: PassesReportFilters;
  groupBy?: PassesGroupByKey[];
  dateRange?: DateRange;
  granularity?: Granularity;
}

export interface PassesReportRow {
  period?: string;
  status?: string;
  ownerRole?: string;
  costBasis?: string;
  origin?: string;
  costBasisSource?: string;
  count: number;
  total_value: string;
}

/**
 * "Where did this pass come from" — a real migration-validation hook, not
 * just a nicety: `legacy-%` is the reserved gateway-ref prefix the legacy
 * migration stamps on its synthesized transactions (docs/MigrationPlan.md
 * §5), so this can separate migrated-history passes from real Stripe
 * activity at a glance, the same distinction /ops/financials and
 * /admin/dashboard's revenue queries still can't make (a known gap, not
 * solved here — see the reporting-overhaul plan's Phase 2 scope).
 */
const ORIGIN_EXPRESSION = `
  CASE
    WHEN t.gateway_ref_id LIKE 'legacy-%' THEN 'legacy'
    WHEN p.batch_id IS NOT NULL THEN 'batch'
    WHEN p.transaction_id IS NOT NULL THEN 'stripe'
    ELSE 'admin_grant'
  END
`.trim();

/**
 * Bucketed, not exact-value — a real design correction found by testing
 * this dataset's cost-basis grouping against real migrated data before
 * writing any of this code: the weighted-average migration conversion
 * (docs/MigrationPlan.md Decision 1) produced 158 distinct effective_price
 * values, one per user's unique purchase history, not a small cluster
 * around a few configured prices as originally assumed. These boundaries
 * are chosen to land close to this app's real historical pricing tiers
 * (member ~$12-13, non-member ~$18-20) — a reasonable v1 default, not
 * derived dynamically from system_settings (a possible future refinement).
 */
const COST_BASIS_BUCKET_EXPRESSION = `
  CASE
    WHEN p.effective_price = 0 THEN '$0'
    WHEN p.effective_price < 12 THEN '<$12'
    WHEN p.effective_price < 14 THEN '$12-14'
    WHEN p.effective_price < 16 THEN '$14-16'
    WHEN p.effective_price < 18 THEN '$16-18'
    WHEN p.effective_price < 20 THEN '$18-20'
    ELSE '$20+'
  END
`.trim();

const PASSES_DIMENSIONS = {
  status: "p.status",
  ownerRole: "u.base_role",
  costBasis: COST_BASIS_BUCKET_EXPRESSION,
  origin: ORIGIN_EXPRESSION,
  // Distinguishes a deliberately-set exact price (a real transaction, an
  // admin-typed grant/batch price, or a migrated free grant confirmed by
  // the legacy ledger) from a migration-time weighted-average estimate —
  // directly answers "how much of the migrated wallet data is still a
  // guess" for validation purposes.
  costBasisSource: "p.cost_basis_source",
} as const;
export type PassesGroupByKey = keyof typeof PASSES_DIMENSIONS;

export interface QueryPlan {
  sql: string;
  values: unknown[];
}

export function buildPassesQuery(params: PassesReportParams): QueryPlan {
  const filters = params.filters ?? {};
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status && filters.status.length > 0) {
    values.push(filters.status);
    conditions.push(`p.status::text = ANY($${values.length}::text[])`);
  }
  if (filters.isTransferable !== undefined) {
    values.push(filters.isTransferable);
    conditions.push(`p.is_transferable = $${values.length}`);
  }
  if (filters.ownerRole && filters.ownerRole.length > 0) {
    values.push(filters.ownerRole);
    conditions.push(`u.base_role::text = ANY($${values.length}::text[])`);
  }
  if (filters.costBasisMin !== undefined) {
    values.push(filters.costBasisMin);
    conditions.push(`p.effective_price >= $${values.length}`);
  }
  if (filters.costBasisMax !== undefined) {
    values.push(filters.costBasisMax);
    conditions.push(`p.effective_price <= $${values.length}`);
  }
  if (filters.origin && filters.origin.length > 0) {
    values.push(filters.origin);
    conditions.push(`(${ORIGIN_EXPRESSION}) = ANY($${values.length}::text[])`);
  }
  if (filters.costBasisSource && filters.costBasisSource.length > 0) {
    // Enum column, not text — must cast the column, not the value (see
    // CLAUDE.md's recurring "operator does not exist" bug class).
    values.push(filters.costBasisSource);
    conditions.push(`p.cost_basis_source::text = ANY($${values.length}::text[])`);
  }

  const dateFragment = dateRangeClause("p.created_at", params.dateRange, values.length);
  conditions.push(dateFragment.clause);
  values.push(...dateFragment.values);

  const { keys: groupByKeys } = resolveGroupBy(params.groupBy, PASSES_DIMENSIONS);
  const selectParts = groupByKeys.map((key) => `${PASSES_DIMENSIONS[key]} AS "${key}"`);
  const groupByParts = groupByKeys.map((key) => PASSES_DIMENSIONS[key]);

  if (params.granularity) {
    const periodExpr = timeBucketExpression("p.created_at", params.granularity);
    selectParts.unshift(`${periodExpr} AS period`);
    groupByParts.unshift(periodExpr);
  }

  const selectPrefix = selectParts.length > 0 ? selectParts.join(", ") + ", " : "";
  const groupByClause = groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(", ")}` : "";
  const orderByClause = groupByParts.length > 0 ? `ORDER BY ${groupByParts.join(", ")}` : "ORDER BY count DESC";

  const sql = `
    SELECT ${selectPrefix}count(*)::int AS count, coalesce(sum(p.effective_price), 0) AS total_value
    FROM passes p
    LEFT JOIN users u ON u.id = p.owner_id
    LEFT JOIN transactions t ON t.id = p.transaction_id
    WHERE ${conditions.join(" AND ")}
    ${groupByClause}
    ${orderByClause}
  `.trim();

  return { sql, values };
}

export async function getPassesReport(params: PassesReportParams): Promise<PassesReportRow[]> {
  const { sql, values } = buildPassesQuery(params);
  const result = await pool.query<PassesReportRow>(sql, values);
  return result.rows;
}
