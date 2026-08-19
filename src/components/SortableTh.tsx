import Link from "next/link";
import { sortHref, sortIndicator, type SortState } from "@/lib/sort";

/**
 * A clickable table-column header that sorts via a plain link (searchParams
 * round-trip, same as every other filter form in this app — no client JS).
 * Reusable across any admin table that adopts src/lib/sort.ts's pattern.
 */
export function SortableTh({
  label,
  columnKey,
  pathname,
  currentParams,
  current,
}: {
  label: string;
  columnKey: string;
  pathname: string;
  currentParams: URLSearchParams;
  current: SortState<string>;
}) {
  return (
    <th>
      <Link href={sortHref(pathname, currentParams, columnKey, current)}>
        {label}
        {sortIndicator(columnKey, current)}
      </Link>
    </th>
  );
}
