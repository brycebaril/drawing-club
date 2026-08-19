import { pool } from "@/lib/db/pool";

export interface HostCandidate {
  username: string;
  displayName: string;
}

/**
 * Every user tagged with the SessionManager volunteer role — what the admin
 * host-selection dropdowns offer. resolveHostUsername below deliberately
 * stays unrestricted (any real user, not just current SessionManagers):
 * an already-assigned host on an existing session (including migrated
 * sessions, whose historical host isn't guaranteed to still hold the role)
 * must stay editable/save-able even if they've since lost the role —
 * this is a UI steering choice for new assignments, not a stricter
 * server-side invariant.
 */
export async function getSessionManagerCandidates(): Promise<HostCandidate[]> {
  const result = await pool.query<{ username: string; display_name: string | null }>(
    `SELECT u.username, u.display_name
     FROM users u
     JOIN volunteer_roles vr ON vr.user_id = u.id
     WHERE vr.role = 'SessionManager'
     ORDER BY COALESCE(u.display_name, u.username)`,
  );
  return result.rows.map((row) => ({ username: row.username, displayName: row.display_name ?? row.username }));
}

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
