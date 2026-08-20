import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import {
  ACCOUNT_STATUSES,
  getMembersReport,
  MEMBERSHIP_STATUSES,
  VOLUNTEER_ROLES,
  type MembersGroupByKey,
} from "@/lib/reporting/membersReport";
import {
  GRANULARITIES,
  parseBooleanParam,
  parseDateParam,
  parseGranularityParam,
  parseListParam,
  toURLSearchParams,
} from "@/lib/reporting/queryFilters";

const GROUP_BY_OPTIONS: { key: MembersGroupByKey; label: string }[] = [
  { key: "baseRole", label: "Base role" },
  { key: "membershipStatus", label: "Membership status" },
  { key: "accountStatus", label: "Account status" },
  { key: "volunteerRole", label: "Volunteer role" },
  { key: "legacyOrigin", label: "Legacy vs. native" },
];

export default async function MembersReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const params = toURLSearchParams(rawParams);

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
  const hasVolunteerRole = parseBooleanParam(params.get("hasVolunteerRole"));
  const staffWithoutActiveMembership = parseBooleanParam(params.get("staffWithoutActiveMembership"));
  const groupBy = (parseListParam(params, "groupBy") as MembersGroupByKey[] | undefined) ?? [];
  const granularity = parseGranularityParam(params.get("granularity"));

  const rows = await getMembersReport({
    filters: {
      baseRole,
      membershipStatus,
      accountStatus,
      hasVolunteerRole,
      volunteerRole,
      legacyOrigin,
      staffWithoutActiveMembership,
    },
    groupBy,
    dateRange: { from: parseDateParam(params.get("dateFrom")), to: parseDateParam(params.get("dateTo")) },
    granularity,
  });

  const columns = [...(granularity ? ["period"] : []), ...groupBy];
  const csvHref = `/admin/reports/members/csv?${params.toString()}`;

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Members report</h1>
        <p>
          <Link href="/admin/reports">← Reports</Link>
        </p>
        <p className="section-note">
          Covers members-by-type, the volunteer roster, and &ldquo;staff without an active membership&rdquo; as filter
          combinations on one dataset — check <em>Has a volunteer role</em> for the roster, or the shortcut below
          for the staff-without-membership view.
        </p>
        <form>
          <fieldset>
            <legend>Base role</legend>
            {(["AccountHolder", "Admin"] as const).map((r) => (
              <label key={r}>
                <input type="checkbox" name="baseRole" value={r} defaultChecked={baseRole?.includes(r)} /> {r}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Membership status</legend>
            {MEMBERSHIP_STATUSES.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  name="membershipStatus"
                  value={s}
                  defaultChecked={membershipStatus?.includes(s)}
                />{" "}
                {s}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Account status</legend>
            {ACCOUNT_STATUSES.map((s) => (
              <label key={s}>
                <input type="checkbox" name="accountStatus" value={s} defaultChecked={accountStatus?.includes(s)} />{" "}
                {s}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Volunteer role</legend>
            {VOLUNTEER_ROLES.map((r) => (
              <label key={r}>
                <input type="checkbox" name="volunteerRole" value={r} defaultChecked={volunteerRole?.includes(r)} />{" "}
                {r}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="hasVolunteerRole">Has a volunteer role</label>
            <select
              id="hasVolunteerRole"
              name="hasVolunteerRole"
              defaultValue={params.get("hasVolunteerRole") ?? ""}
            >
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            <label htmlFor="legacyOrigin">Origin</label>
            <select id="legacyOrigin" name="legacyOrigin" defaultValue={legacyOrigin ?? ""}>
              <option value="">Any</option>
              <option value="legacy">Legacy-migrated</option>
              <option value="native">Native signup</option>
            </select>
          </div>
          <div>
            <label htmlFor="staffWithoutActiveMembership">
              <input
                id="staffWithoutActiveMembership"
                name="staffWithoutActiveMembership"
                type="checkbox"
                value="true"
                defaultChecked={staffWithoutActiveMembership === true}
              />{" "}
              Volunteers/admins without an active membership
            </label>
          </div>
          <div>
            <label htmlFor="dateFrom">Renewed/joined from</label>
            <input id="dateFrom" name="dateFrom" type="date" defaultValue={params.get("dateFrom") ?? ""} />
            <label htmlFor="dateTo">to</label>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c}>{String(row[c as keyof typeof row] ?? "—")}</td>
                  ))}
                  <td className="num">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
