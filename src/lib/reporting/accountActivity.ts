import { pool } from "@/lib/db/pool";

export interface AccountActivityRow {
  new_accounts: number;
  new_signups: number;
  renewals: number;
  expirations: number;
}

export interface AccountActivityStats {
  newAccounts: number;
  newMembershipSignups: number;
  renewals: number;
  membershipExpirations: number;
}

/** Pure reshape, split out for unit testing separate from the DB round-trip. */
export function summarizeAccountActivity(row: AccountActivityRow): AccountActivityStats {
  return {
    newAccounts: row.new_accounts,
    newMembershipSignups: row.new_signups,
    renewals: row.renewals,
    membershipExpirations: row.expirations,
  };
}

/**
 * New accounts / new signups / renewals / expirations, all trailing 7 days.
 *
 * "New signup" vs. "renewal" is a user's first-ever membership_history row
 * vs. any later one — ranked over that user's FULL history first, then
 * filtered to the trailing week, not filtered first. Filtering to the week
 * before ranking would misclassify a renewal as a "new signup" whenever a
 * user's only *other* membership_history row happens to sit outside the
 * window (i.e. almost always, for a returning member).
 *
 * `new_accounts` excludes legacy-migrated users (`legacy_id IS NOT NULL`) —
 * every migrated user shares one synthetic `created_at` (the migration
 * run's own timestamp, not a real signup date — legacy `session_attendees`
 * has no signup-date column to backfill from at all), so right after any
 * migration/rehearsal run, this would otherwise count the ENTIRE migrated
 * population as "new this week" (confirmed: 4,185 of 4,234 real local-dev
 * users, all sharing one identical email_verified_at/created_at timestamp).
 * Deliberately NOT applied to new_signups/renewals below — those come from
 * membership_history.created_at, which this table's own backfill migration
 * already dates per-row from a real transaction/valid_from timestamp, never
 * a shared synthetic one, and a migrated member's real future renewal must
 * still count — excluding by legacy_id there would hide it forever.
 */
export async function getAccountActivityStats(): Promise<AccountActivityStats> {
  const result = await pool.query<AccountActivityRow>(
    `WITH ranked AS (
       SELECT user_id, created_at,
              row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn
       FROM membership_history
     )
     SELECT
       (SELECT count(*) FROM users WHERE created_at >= now() - interval '7 days' AND legacy_id IS NULL)::int AS new_accounts,
       count(*) FILTER (WHERE rn = 1 AND created_at >= now() - interval '7 days')::int AS new_signups,
       count(*) FILTER (WHERE rn > 1 AND created_at >= now() - interval '7 days')::int AS renewals,
       (SELECT count(*) FROM users
        WHERE membership_expires_at >= now() - interval '7 days' AND membership_expires_at < now())::int AS expirations
     FROM ranked`,
  );
  return summarizeAccountActivity(result.rows[0]);
}
