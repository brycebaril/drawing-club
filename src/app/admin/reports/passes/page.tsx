import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import {
  COST_BASIS_SOURCES,
  getPassesReport,
  PASS_ORIGINS,
  PASS_STATUSES,
  type PassesGroupByKey,
} from "@/lib/reporting/passesReport";
import {
  GRANULARITIES,
  parseBooleanParam,
  parseDateParam,
  parseGranularityParam,
  parseListParam,
  parseNumberParam,
  toURLSearchParams,
} from "@/lib/reporting/queryFilters";

const GROUP_BY_OPTIONS: { key: PassesGroupByKey; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "ownerRole", label: "Owner role" },
  { key: "costBasis", label: "Cost basis" },
  { key: "origin", label: "Origin" },
  { key: "costBasisSource", label: "Cost basis type (exact/estimated)" },
];

export default async function PassesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const params = toURLSearchParams(rawParams);

  const status = parseListParam(params, "status")?.filter((s): s is (typeof PASS_STATUSES)[number] =>
    (PASS_STATUSES as readonly string[]).includes(s),
  );
  const origin = parseListParam(params, "origin")?.filter((o): o is (typeof PASS_ORIGINS)[number] =>
    (PASS_ORIGINS as readonly string[]).includes(o),
  );
  const costBasisSource = parseListParam(params, "costBasisSource")?.filter(
    (s): s is (typeof COST_BASIS_SOURCES)[number] => (COST_BASIS_SOURCES as readonly string[]).includes(s),
  );
  const groupBy = (parseListParam(params, "groupBy") as PassesGroupByKey[] | undefined) ?? [];
  const granularity = parseGranularityParam(params.get("granularity"));
  const isTransferable = parseBooleanParam(params.get("isTransferable"));

  const rows = await getPassesReport({
    filters: {
      status,
      isTransferable,
      ownerRole: parseListParam(params, "ownerRole"),
      costBasisMin: parseNumberParam(params.get("costBasisMin")),
      costBasisMax: parseNumberParam(params.get("costBasisMax")),
      origin,
      costBasisSource,
    },
    groupBy,
    dateRange: { from: parseDateParam(params.get("dateFrom")), to: parseDateParam(params.get("dateTo")) },
    granularity,
  });

  const columns = [...(granularity ? ["period"] : []), ...groupBy];
  const csvHref = `/admin/reports/passes/csv?${params.toString()}`;

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Tickets report</h1>
        <p>
          <Link href="/admin/reports">← Reports</Link>
        </p>
        <form>
          <fieldset>
            <legend>Status</legend>
            {PASS_STATUSES.map((s) => (
              <label key={s}>
                <input type="checkbox" name="status" value={s} defaultChecked={status?.includes(s)} /> {s}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Owner role</legend>
            {(["AccountHolder", "Admin"] as const).map((r) => (
              <label key={r}>
                <input
                  type="checkbox"
                  name="ownerRole"
                  value={r}
                  defaultChecked={parseListParam(params, "ownerRole")?.includes(r)}
                />{" "}
                {r}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Origin</legend>
            {PASS_ORIGINS.map((o) => (
              <label key={o}>
                <input type="checkbox" name="origin" value={o} defaultChecked={origin?.includes(o)} /> {o}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Cost basis type</legend>
            {COST_BASIS_SOURCES.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  name="costBasisSource"
                  value={s}
                  defaultChecked={costBasisSource?.includes(s)}
                />{" "}
                {s}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="isTransferable">Transferable</label>
            <select id="isTransferable" name="isTransferable" defaultValue={params.get("isTransferable") ?? ""}>
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <label htmlFor="costBasisMin">Cost basis min</label>
            <input
              id="costBasisMin"
              name="costBasisMin"
              type="number"
              step="0.01"
              defaultValue={params.get("costBasisMin") ?? ""}
            />
            <label htmlFor="costBasisMax">Cost basis max</label>
            <input
              id="costBasisMax"
              name="costBasisMax"
              type="number"
              step="0.01"
              defaultValue={params.get("costBasisMax") ?? ""}
            />
          </div>
          <div>
            <label htmlFor="dateFrom">From</label>
            <input id="dateFrom" name="dateFrom" type="date" defaultValue={params.get("dateFrom") ?? ""} />
            <label htmlFor="dateTo">To</label>
            <input id="dateTo" name="dateTo" type="date" defaultValue={params.get("dateTo") ?? ""} />
            <label htmlFor="granularity">Granularity</label>
            <select id="granularity" name="granularity" defaultValue={granularity ?? ""}>
              <option value="">None</option>
              {GRANULARITIES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend>Group by</legend>
            {GROUP_BY_OPTIONS.map((opt) => (
              <label key={opt.key}>
                <input type="checkbox" name="groupBy" value={opt.key} defaultChecked={groupBy.includes(opt.key)} />{" "}
                {opt.label}
              </label>
            ))}
          </fieldset>
          <button type="submit">Apply</button>
        </form>
        <p>
          <a href={csvHref}>Export CSV</a>
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th className="num">Count</th>
                <th className="num">Total value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c}>{String(row[c as keyof typeof row] ?? "—")}</td>
                  ))}
                  <td className="num">{row.count}</td>
                  <td className="num">${row.total_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
