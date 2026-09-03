import { pool } from "@/lib/db/pool";

export interface UserRoleStatusRow {
  base_role: string;
  status: string;
  count: number;
}

export interface UserStats {
  totalUsers: number;
  byBaseRole: Record<string, number>;
  byStatus: Record<string, number>;
  activeMembers: number;
  /** Real opt-in count, matching /admin/users' own marketing-opt-in filter/export. */
  marketingOptInCount: number;
}

/** Pure rollup, split out for unit testing separate from the DB round-trip. */
export function summarizeUserRows(
  rows: UserRoleStatusRow[],
): Pick<UserStats, "totalUsers" | "byBaseRole" | "byStatus"> {
  const byBaseRole: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalUsers = 0;

  for (const row of rows) {
    byBaseRole[row.base_role] = (byBaseRole[row.base_role] ?? 0) + row.count;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
    totalUsers += row.count;
  }

  return { totalUsers, byBaseRole, byStatus };
}

export async function getUserStats(): Promise<UserStats> {
  const rowsResult = await pool.query<UserRoleStatusRow>(
    `SELECT base_role, status, count(*)::int AS count FROM users GROUP BY base_role, status`,
  );
  const activeMembersResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM users WHERE membership_expires_at > now()`,
  );
  const marketingOptInResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM users WHERE marketing_email_opt_in = true`,
  );

  return {
    ...summarizeUserRows(rowsResult.rows),
    activeMembers: activeMembersResult.rows[0].count,
    marketingOptInCount: marketingOptInResult.rows[0].count,
  };
}
