import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import {
  ACCOUNT_STATUSES,
  getMembersReport,
  MEMBERSHIP_STATUSES,
  VOLUNTEER_ROLES,
  type MembersGroupByKey,
} from "@/lib/reporting/membersReport";
import { parseBooleanParam, parseDateParam, parseGranularityParam, parseListParam } from "@/lib/reporting/queryFilters";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Mirrors passesReport's csv route — see its own doc comment for the auth-check rationale. */
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
  const baseRole = parseListParam(params, "baseRole")?.filter(
    (r): r is "AccountHolder" | "Admin" => r === "AccountHolder" || r === "Admin",
  );
  const membershipStatus = parseListParam(params, "membershipStatus")?.filter(
    (s): s is (typeof MEMBERSHIP_STATUSES)[number] => (MEMBERSHIP_STATUSES as readonly string[]).includes(s),
  );
  const accountStatus = parseListParam(params, "accountStatus")?.filter(
    (s): s is (typeof ACCOUNT_STATUSES)[number] => (ACCOUNT_STATUSES as readonly string[]).includes(s),
  );
  const volunteerRole = parseListParam(params, "volunteerRole")?.filter(
    (r): r is (typeof VOLUNTEER_ROLES)[number] => (VOLUNTEER_ROLES as readonly string[]).includes(r),
  );
  const legacyOriginParam = params.get("legacyOrigin");
  const legacyOrigin = legacyOriginParam === "legacy" || legacyOriginParam === "native" ? legacyOriginParam : undefined;
  const groupBy = (parseListParam(params, "groupBy") as MembersGroupByKey[] | undefined) ?? [];
  const granularity = parseGranularityParam(params.get("granularity"));

  const rows = await getMembersReport({
    filters: {
      baseRole,
      membershipStatus,
      accountStatus,
      hasVolunteerRole: parseBooleanParam(params.get("hasVolunteerRole")),
      volunteerRole,
      legacyOrigin,
      staffWithoutActiveMembership: parseBooleanParam(params.get("staffWithoutActiveMembership")),
    },
    groupBy,
    dateRange: { from: parseDateParam(params.get("dateFrom")), to: parseDateParam(params.get("dateTo")) },
    granularity,
  });

  const columns = [...(granularity ? ["period"] : []), ...groupBy];
  const lines = [[...columns, "count"].map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      [...columns.map((c) => String(row[c as keyof typeof row] ?? "")), String(row.count)].map(csvEscape).join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="members-report.csv"`,
    },
  });
}
