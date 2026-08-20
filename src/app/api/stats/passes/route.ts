import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import {
  COST_BASIS_SOURCES,
  getPassesReport,
  PASS_ORIGINS,
  PASS_STATUSES,
  type PassesGroupByKey,
} from "@/lib/reporting/passesReport";
import {
  parseBooleanParam,
  parseDateParam,
  parseGranularityParam,
  parseListParam,
  parseNumberParam,
} from "@/lib/reporting/queryFilters";

/**
 * Parameterized, not fixed — reporting-overhaul Phase 1. Every filter/
 * group-by/date-range param is optional; an empty query string behaves
 * like the old fixed reports (everything, ungrouped, no date bound).
 * Multi-value filters use repeated keys (`?status=Available&status=Used`),
 * matching how an HTML form's checkboxes submit and how a curl/API
 * consumer can construct a query just as easily — one format for both.
 *
 * ?status=Available&status=Used&isTransferable=false&ownerRole=Admin
 * &costBasisMin=10&costBasisMax=20&origin=legacy&origin=stripe
 * &costBasisSource=Estimated
 * &groupBy=costBasis&groupBy=origin&dateFrom=2026-01-01&dateTo=2026-06-01&granularity=month
 */
export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "passes");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const params = new URL(request.url).searchParams;

  const status = parseListParam(params, "status")?.filter((s): s is (typeof PASS_STATUSES)[number] =>
    (PASS_STATUSES as readonly string[]).includes(s),
  );
  const origin = parseListParam(params, "origin")?.filter((o): o is (typeof PASS_ORIGINS)[number] =>
    (PASS_ORIGINS as readonly string[]).includes(o),
  );
  const costBasisSource = parseListParam(params, "costBasisSource")?.filter(
    (s): s is (typeof COST_BASIS_SOURCES)[number] => (COST_BASIS_SOURCES as readonly string[]).includes(s),
  );

  const report = await getPassesReport({
    filters: {
      status,
      isTransferable: parseBooleanParam(params.get("isTransferable")),
      ownerRole: parseListParam(params, "ownerRole"),
      costBasisMin: parseNumberParam(params.get("costBasisMin")),
      costBasisMax: parseNumberParam(params.get("costBasisMax")),
      origin,
      costBasisSource,
    },
    groupBy: parseListParam(params, "groupBy") as PassesGroupByKey[] | undefined,
    dateRange: {
      from: parseDateParam(params.get("dateFrom")),
      to: parseDateParam(params.get("dateTo")),
    },
    granularity: parseGranularityParam(params.get("granularity")),
  });

  return NextResponse.json(report);
}
