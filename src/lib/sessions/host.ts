import { pool } from "@/lib/db/pool";

export type ResolveHostResult = { ok: true; hostUserId: string | null } | { ok: false; error: string };

/** Resolves an optional host username to a user id — blank means "open host slot" (Design Doc §9.2). */
export async function resolveHostUsername(hostUsername: string): Promise<ResolveHostResult> {
  const trimmed = hostUsername.trim();
  if (!trimmed) return { ok: true, hostUserId: null };

  const hostRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    trimmed,
  ]);
  if (hostRow.rowCount === 0) {
    return { ok: false, error: `No user found with username "${trimmed}".` };
  }
  return { ok: true, hostUserId: hostRow.rows[0].id };
}
