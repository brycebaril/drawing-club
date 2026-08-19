import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import {
  ACCOUNT_STATUSES,
  getMembersReport,
  MEMBERSHIP_STATUSES,
  VOLUNTEER_ROLES,
  type MembersGroupByKey,
} from "@/lib/reporting/membersReport";
import { parseBooleanParam, parseDateParam, parseGranularityParam, parseListParam } from "@/lib/reporting/queryFilters";

/**
 * Parameterized, not fixed — reporting-overhaul Phase 1. Subsumes three of
 * the requested reports as filter combinations on this one dataset (see
 * src/lib/reporting/membersReport.ts's own doc comments): "members by
 * type" (group by baseRole/membershipStatus), "volunteer report" (filter
 * hasVolunteerRole=true), "volunteers/admins without an active membership"
 * (staffWithoutActiveMembership=true). Multi-value filters use repeated
 * keys (`?baseRole=Admin&baseRole=...`), matching how an HTML form's
 * checkboxes submit and how a curl/API consumer can construct a query
 * just as easily.
 *
 * ?baseRole=Admin&membershipStatus=active&membershipStatus=expired
 * &accountStatus=Active&hasVolunteerRole=true
 * &volunteerRole=Board&volunteerRole=SessionManager
 * &legacyOrigin=legacy&staffWithoutActiveMembership=true
 * &groupBy=baseRole&groupBy=membershipStatus&dateFrom=2026-01-01&granularity=month
 */
export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "members");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
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

  const report = await getMembersReport({
    filters: {
      baseRole,
      membershipStatus,
      accountStatus,
      hasVolunteerRole: parseBooleanParam(params.get("hasVolunteerRole")),
      volunteerRole,
      legacyOrigin,
      staffWithoutActiveMembership: parseBooleanParam(params.get("staffWithoutActiveMembership")),
    },
    groupBy: parseListParam(params, "groupBy") as MembersGroupByKey[] | undefined,
    dateRange: {
      from: parseDateParam(params.get("dateFrom")),
      to: parseDateParam(params.get("dateTo")),
    },
    granularity: parseGranularityParam(params.get("granularity")),
  });

  return NextResponse.json(report);
}
