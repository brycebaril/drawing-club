import { pool } from "@/lib/db/pool";

export interface AccountClassRow {
  admin_total: number;
  admin_active: number;
  volunteer_total: number;
  volunteer_active: number;
  member_total: number;
  member_active: number;
  account_holder_total: number;
  account_holder_active: number;
}

export interface AccountClassSummary {
  total: number;
  activeThisWeek: number;
  /** null rather than 0 for an empty class — matches attendance.ts's no-data convention. */
  activePct: number | null;
}

export interface AccountClassStats {
  admin: AccountClassSummary;
  volunteer: AccountClassSummary;
  member: AccountClassSummary;
  accountHolder: AccountClassSummary;
}

function summarizeClass(total: number, active: number): AccountClassSummary {
  return { total, activeThisWeek: active, activePct: total > 0 ? active / total : null };
}

/** Pure rollup, split out for unit testing separate from the DB round-trip. */
export function summarizeAccountClasses(row: AccountClassRow): AccountClassStats {
  return {
    admin: summarizeClass(row.admin_total, row.admin_active),
    volunteer: summarizeClass(row.volunteer_total, row.volunteer_active),
    member: summarizeClass(row.member_total, row.member_active),
    accountHolder: summarizeClass(row.account_holder_total, row.account_holder_active),
  };
}

/**
 * Four overlapping account classes, not a mutually-exclusive partition:
 * Admin/Volunteer/Member can all overlap with each other and with each
 * other's counts (an Admin who's also a Member counts in both). Only
 * Member and Account Holder are complements of each other. "Account
 * Holder" here means "not currently an active member" — deliberately NOT
 * `base_role = 'AccountHolder'`, since an Admin with a lapsed membership
 * is both an Admin and an Account Holder under this definition.
 *
 * "Active this week" = hosted or attended (checked in to) a session in the
 * trailing 7 days — the same booking-union shape attendance.ts already
 * establishes (passes for generic sessions, seat_reservations for series).
 */
export async function getAccountClassStats(): Promise<AccountClassStats> {
  const result = await pool.query<AccountClassRow>(
    `WITH classified AS (
       SELECT u.id,
         (u.base_role = 'Admin') AS is_admin,
         EXISTS (SELECT 1 FROM volunteer_roles vr WHERE vr.user_id = u.id) AS is_volunteer,
         -- COALESCE(..., false) is load-bearing, not defensive styling: for
         -- a user who's never had a membership, membership_expires_at IS
         -- NULL, so "> now()" evaluates to SQL NULL rather than false. Both
         -- "WHERE is_member" and "WHERE NOT is_member" exclude a NULL row
         -- (three-valued logic) -- without this, that user vanishes from
         -- BOTH the Member and Account Holder buckets below, silently
         -- undercounting the real population by however many users have
         -- never held a membership (confirmed: undercounted by 3,686 of
         -- 4,234 real local-dev users before this fix).
         COALESCE(u.membership_expires_at > now(), false) AS is_member
       FROM users u
     ),
     active_this_week AS (
       SELECT DISTINCT user_id FROM (
         SELECT s.host_user_id AS user_id FROM sessions s
         WHERE s.host_user_id IS NOT NULL AND s.status != 'Canceled'
           AND s.start_time >= now() - interval '7 days' AND s.start_time < now()
         UNION
         SELECT p.owner_id AS user_id FROM passes p JOIN sessions s ON s.id = p.session_id
         WHERE p.status = 'Used' AND p.checked_in
           AND s.start_time >= now() - interval '7 days' AND s.start_time < now()
         UNION
         SELECT sr.user_id FROM seat_reservations sr JOIN sessions s ON s.id = sr.session_id
         WHERE sr.checked_in
           AND s.start_time >= now() - interval '7 days' AND s.start_time < now()
       ) attended
     )
     SELECT
       count(*) FILTER (WHERE c.is_admin)::int AS admin_total,
       count(*) FILTER (WHERE c.is_admin AND atw.user_id IS NOT NULL)::int AS admin_active,
       count(*) FILTER (WHERE c.is_volunteer)::int AS volunteer_total,
       count(*) FILTER (WHERE c.is_volunteer AND atw.user_id IS NOT NULL)::int AS volunteer_active,
       count(*) FILTER (WHERE c.is_member)::int AS member_total,
       count(*) FILTER (WHERE c.is_member AND atw.user_id IS NOT NULL)::int AS member_active,
       count(*) FILTER (WHERE NOT c.is_member)::int AS account_holder_total,
       count(*) FILTER (WHERE NOT c.is_member AND atw.user_id IS NOT NULL)::int AS account_holder_active
     FROM classified c LEFT JOIN active_this_week atw ON atw.user_id = c.id`,
  );
  return summarizeAccountClasses(result.rows[0]);
}
