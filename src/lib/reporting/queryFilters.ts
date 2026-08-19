/**
 * Shared building blocks for the parameterized report datasets
 * (passesReport.ts, membersReport.ts, and future ones) — the mechanism
 * that keeps "parameterized" from becoming "arbitrary SQL." A caller can
 * only ever select from a dataset's own fixed dimension map; dates and
 * granularity are always bound as real query parameters, never
 * string-interpolated.
 */

export interface DateRange {
  from?: Date;
  to?: Date;
}

export const GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface SqlFragment {
  clause: string;
  values: unknown[];
}

/**
 * Builds a parameterized date-range WHERE clause against `column`,
 * starting param numbering at `paramOffset + 1`. Returns an empty clause
 * ("1=1", no values) when neither bound is set, so callers can always
 * splice this into an AND-chain without a special no-op case.
 */
export function dateRangeClause(column: string, range: DateRange | undefined, paramOffset: number): SqlFragment {
  if (!range || (!range.from && !range.to)) {
    return { clause: "1=1", values: [] };
  }
  const parts: string[] = [];
  const values: unknown[] = [];
  if (range.from) {
    values.push(range.from);
    parts.push(`${column} >= $${paramOffset + values.length}`);
  }
  if (range.to) {
    values.push(range.to);
    parts.push(`${column} <= $${paramOffset + values.length}`);
  }
  return { clause: parts.join(" AND "), values };
}

/** `date_trunc('week', column)` etc. — `granularity` is a checked TS union, never a raw caller string. */
export function timeBucketExpression(column: string, granularity: Granularity): string {
  return `date_trunc('${granularity}', ${column})`;
}

/**
 * Validates a caller-supplied list of group-by keys against a dataset's
 * own allowlisted dimension map, returning only the ones that exist in it
 * (in the caller's requested order) plus any that were dropped. Never lets
 * an unrecognized key reach SQL.
 */
/**
 * Next.js Server Component `searchParams` props are a plain object
 * ({[key]: string | string[] | undefined}), not a URLSearchParams instance
 * — this bridges it to one so pages can reuse the exact same
 * parseListParam/etc. helpers the API routes use, one parsing story for
 * both consumers.
 */
export function toURLSearchParams(searchParams: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  return params;
}

// --- Query-string parsing (shared by every /api/stats/* report route) ---

/**
 * Repeated query keys (`?status=Available&status=Used`), not a comma-
 * joined single value — this is what an HTML form's checkboxes/native
 * multi-select naturally submit, and it's the same shape a direct
 * curl/API consumer can construct just as easily, so one format serves
 * both the on-site UI and the AI-API use case without any client JS to
 * join values together.
 */
export function parseListParam(searchParams: URLSearchParams, key: string): string[] | undefined {
  const values = searchParams.getAll(key).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function parseNumberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseGranularityParam(value: string | null): Granularity | undefined {
  return GRANULARITIES.includes(value as Granularity) ? (value as Granularity) : undefined;
}

export function resolveGroupBy<K extends string>(
  requested: string[] | undefined,
  dimensions: Record<K, string>,
): { keys: K[]; unknown: string[] } {
  const keys: K[] = [];
  const unknownKeys: string[] = [];
  for (const key of requested ?? []) {
    if (Object.hasOwn(dimensions, key)) {
      keys.push(key as K);
    } else {
      unknownKeys.push(key);
    }
  }
  return { keys, unknown: unknownKeys };
}
