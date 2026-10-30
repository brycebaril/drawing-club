import { pool } from "@/lib/db/pool";
import { dateRangeClause, resolveGroupBy, timeBucketExpression, type DateRange, type Granularity } from "./queryFilters";

// "Deleted" (GDPR-style anonymization, src/app/admin/users/[id]/actions.ts's
// anonymizeAccountAction) was missing here — an API consumer's
// ?accountStatus=Deleted was silently dropped by this allowlist even though
// the users table itself has held the status for a while (filterUsers.ts's
// own UserRow type already included it).
export const ACCOUNT_STATUSES = ["Active", "Suspended", "Banned", "Deleted"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["active", "expired", "never"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// GenericVolunteer and SupportAgent were added to the app after this list
// was written (matches admin/users/[id]/page.tsx's own VOLUNTEER_ROLE_LABELS,
// which already has both) — same drift as ACCOUNT_STATUSES above.
export const VOLUNTEER_ROLES = [
  "SessionManager",
  "ContentEditor",
  "ModelBooker",
  "Controller",
  "Board",
  "SupportAgent",
  "GenericVolunteer",
] as const;
export type VolunteerRole = (typeof VOLUNTEER_ROLES)[number];

export interface MembersReportFilters {
  baseRole?: ("AccountHolder" | "Admin")[];
  membershipStatus?: MembershipStatus[];
  accountStatus?: AccountStatus[];
  hasVolunteerRole?: boolean;
  volunteerRole?: VolunteerRole[];
  legacyOrigin?: "legacy" | "native";
  /**
   * Purpose-built for one of the three reports this dataset subsumes
   * (docs — reporting-overhaul plan, Dataset 2): "volunteers/admins who
   * don't have an active membership." Expressing this as an OR across two
   * otherwise-AND-only filters isn't possible with the general filter
   * primitives below, so it gets its own explicit flag rather than
   * reaching for a generic boolean-expression filter system (which the
   * org deliberately decided against for this overhaul).
   */
  staffWithoutActiveMembership?: boolean;
}

export interface MembersReportParams {
  filters?: MembersReportFilters;
  groupBy?: MembersGroupByKey[];
  /** Time segmentation keys off membership_history.valid_from, not a
   * user-creation date — see membershipStatus's own doc comment for why. */
  dateRange?: DateRange;
  granularity?: Granularity;
}

export interface MembersReportRow {
  period?: string;
  baseRole?: string;
  membershipStatus?: string;
  accountStatus?: string;
  volunteerRole?: string | null;
  legacyOrigin?: string;
  count: number;
}

const MEMBERSHIP_STATUS_EXPRESSION = `
  CASE
    WHEN u.membership_expires_at IS NULL THEN 'never'
    WHEN u.membership_expires_at > now() THEN 'active'
    ELSE 'expired'
  END
`.trim();

const LEGACY_ORIGIN_EXPRESSION = `CASE WHEN u.legacy_id IS NOT NULL THEN 'legacy' ELSE 'native' END`;

const MEMBERS_DIMENSIONS = {
  baseRole: "u.base_role",
  membershipStatus: MEMBERSHIP_STATUS_EXPRESSION,
  accountStatus: "u.status",
  volunteerRole: "vr.role",
  legacyOrigin: LEGACY_ORIGIN_EXPRESSION,
} as const;
export type MembersGroupByKey = keyof typeof MEMBERS_DIMENSIONS;

export interface QueryPlan {
  sql: string;
  values: unknown[];
}

export function buildMembersQuery(params: MembersReportParams): QueryPlan {
  const filters = params.filters ?? {};
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.baseRole && filters.baseRole.length > 0) {
    values.push(filters.baseRole);
    conditions.push(`u.base_role::text = ANY($${values.length}::text[])`);
  }
  if (filters.membershipStatus && filters.membershipStatus.length > 0) {
    values.push(filters.membershipStatus);
    conditions.push(`(${MEMBERSHIP_STATUS_EXPRESSION}) = ANY($${values.length}::text[])`);
  }
  if (filters.accountStatus && filters.accountStatus.length > 0) {
    values.push(filters.accountStatus);
    conditions.push(`u.status::text = ANY($${values.length}::text[])`);
  }
  if (filters.hasVolunteerRole !== undefined) {
    const existsClause = "EXISTS (SELECT 1 FROM volunteer_roles vre WHERE vre.user_id = u.id)";
    conditions.push(filters.hasVolunteerRole ? existsClause : `NOT ${existsClause}`);
  }
  if (filters.volunteerRole && filters.volunteerRole.length > 0) {
    values.push(filters.volunteerRole);
    conditions.push(
      `EXISTS (SELECT 1 FROM volunteer_roles vrf WHERE vrf.user_id = u.id AND vrf.role::text = ANY($${values.length}::text[]))`,
    );
  }
  if (filters.legacyOrigin) {
    conditions.push(filters.legacyOrigin === "legacy" ? "u.legacy_id IS NOT NULL" : "u.legacy_id IS NULL");
  }
  if (filters.staffWithoutActiveMembership) {
    conditions.push(
      `(EXISTS (SELECT 1 FROM volunteer_roles vrs WHERE vrs.user_id = u.id) OR u.base_role = 'Admin')`,
    );
    conditions.push(`(u.membership_expires_at IS NULL OR u.membership_expires_at <= now())`);
  }

  const dateFragment = dateRangeClause("mh.valid_from", params.dateRange, values.length);
  const needsMembershipHistoryJoin = Boolean(params.dateRange?.from || params.dateRange?.to);
  conditions.push(dateFragment.clause);
  values.push(...dateFragment.values);

  const { keys: groupByKeys } = resolveGroupBy(params.groupBy, MEMBERS_DIMENSIONS);
  const needsVolunteerRolesJoin = groupByKeys.includes("volunteerRole");

  const selectParts = groupByKeys.map((key) => `${MEMBERS_DIMENSIONS[key]} AS "${key}"`);
  const groupByParts = groupByKeys.map((key) => MEMBERS_DIMENSIONS[key]);

  if (params.granularity) {
    const periodExpr = timeBucketExpression("mh.valid_from", params.granularity);
    selectParts.unshift(`${periodExpr} AS period`);
    groupByParts.unshift(periodExpr);
  }

  const selectPrefix = selectParts.length > 0 ? selectParts.join(", ") + ", " : "";
  const groupByClause = groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(", ")}` : "";
  const orderByClause = groupByParts.length > 0 ? `ORDER BY ${groupByParts.join(", ")}` : "ORDER BY count DESC";

  // count(DISTINCT u.id) throughout — a volunteer_roles/membership_history
  // join can fan a single user out into multiple rows (multiple roles,
  // multiple membership periods), and a plain count(*) would double-count
  // them whenever that join is present.
  const sql = `
    SELECT ${selectPrefix}count(DISTINCT u.id)::int AS count
    FROM users u
    ${needsVolunteerRolesJoin ? "LEFT JOIN volunteer_roles vr ON vr.user_id = u.id" : ""}
    ${needsMembershipHistoryJoin || params.granularity ? "LEFT JOIN membership_history mh ON mh.user_id = u.id" : ""}
    WHERE ${conditions.join(" AND ")}
    ${groupByClause}
    ${orderByClause}
  `.trim();

  return { sql, values };
}

export async function getMembersReport(params: MembersReportParams): Promise<MembersReportRow[]> {
  const { sql, values } = buildMembersQuery(params);
  const result = await pool.query<MembersReportRow>(sql, values);
  return result.rows;
}
