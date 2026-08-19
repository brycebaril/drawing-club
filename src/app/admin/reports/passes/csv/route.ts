import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getPassesReport, PASS_ORIGINS, PASS_STATUSES, type PassesGroupByKey } from "@/lib/reporting/passesReport";
import { parseBooleanParam, parseDateParam, parseGranularityParam, parseListParam } from "@/lib/reporting/queryFilters";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Mirrors the /ops/financials CSV export routes' exact shape (own auth
 * check, csvEscape, Content-Disposition: attachment) — technically
 * redundant with src/proxy.ts's own /admin ADMIN-only rule (confirmed
 * against its matcher, which only excludes api/, _next/static,
 * _next/image, and favicon.ico), kept anyway for consistency with the
 * established CSV export convention in this codebase.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const status = parseListParam(params, "status")?.filter((s): s is (typeof PASS_STATUSES)[number] =>
    (PASS_STATUSES as readonly string[]).includes(s),
  );
  const origin = parseListParam(params, "origin")?.filter((o): o is (typeof PASS_ORIGINS)[number] =>
    (PASS_ORIGINS as readonly string[]).includes(o),
  );
  const groupBy = (parseListParam(params, "groupBy") as PassesGroupByKey[] | undefined) ?? [];
  const granularity = parseGranularityParam(params.get("granularity"));

  const rows = await getPassesReport({
    filters: {
      status,
      isTransferable: parseBooleanParam(params.get("isTransferable")),
      ownerRole: parseListParam(params, "ownerRole"),
      origin,
    },
    groupBy,
    dateRange: { from: parseDateParam(params.get("dateFrom")), to: parseDateParam(params.get("dateTo")) },
    granularity,
  });

  const columns = [...(granularity ? ["period"] : []), ...groupBy];
  const lines = [[...columns, "count", "total_value"].map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      [...columns.map((c) => String(row[c as keyof typeof row] ?? "")), String(row.count), row.total_value]
        .map(csvEscape)
        .join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="passes-report.csv"`,
    },
  });
}
