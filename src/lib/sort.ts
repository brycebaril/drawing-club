/**
 * Shared mechanism for clickable, sortable table-column headers on plain
 * server-rendered admin tables (no client JS — same searchParams-driven
 * convention already used for filter forms app-wide). Same discipline as
 * the reporting datasets' dimension maps (src/lib/reporting/queryFilters.ts):
 * a page defines its own fixed Record<columnKey, sqlExpression> allowlist,
 * and only a key that exists in it can ever reach an ORDER BY clause —
 * never a raw caller string.
 */

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: SortDirection;
}

/**
 * Resolves the requested sort key/direction against an allowlisted
 * column map, falling back to defaultKey/defaultDir when the requested
 * key is missing or unrecognized.
 */
export function resolveSort<K extends string>(
  requestedKey: string | undefined,
  requestedDir: string | undefined,
  columns: Record<K, string>,
  defaultKey: K,
  defaultDir: SortDirection = "asc",
): { state: SortState<K>; orderBy: string } {
  const key = (requestedKey && Object.hasOwn(columns, requestedKey) ? requestedKey : defaultKey) as K;
  const dir: SortDirection = requestedDir === "desc" ? "desc" : requestedDir === "asc" ? "asc" : defaultDir;
  return { state: { key, dir }, orderBy: `${columns[key]} ${dir.toUpperCase()}` };
}

/**
 * Href for a clickable column header: clicking the currently-sorted
 * column flips its direction; clicking any other column sorts by it
 * ascending. Preserves every other query param already on the page
 * (filters, etc.) so sorting composes with existing filter forms.
 */
export function sortHref(
  pathname: string,
  currentParams: URLSearchParams,
  columnKey: string,
  current: SortState<string>,
): string {
  const params = new URLSearchParams(currentParams);
  const nextDir: SortDirection = current.key === columnKey && current.dir === "asc" ? "desc" : "asc";
  params.set("sort", columnKey);
  params.set("dir", nextDir);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function sortIndicator(columnKey: string, current: SortState<string>): string {
  if (current.key !== columnKey) return "";
  return current.dir === "asc" ? " ▲" : " ▼";
}
