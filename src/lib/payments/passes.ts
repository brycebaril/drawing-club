import { pool } from "@/lib/db/pool";

/**
 * Count of this user's spendable tickets (any type — standard or
 * transferable, 'Available' status) — backs the "you don't have any
 * tickets yet" prompts on the dashboard and schedule page. A brand-new
 * member buying their first ticket is the very first thing they need to do
 * before they can book a session, so this is checked in more than one place.
 */
export async function getAvailableTicketCount(userId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM passes WHERE owner_id = $1 AND status = 'Available'`,
    [userId],
  );
  return result.rows[0].count;
}
