"use server";

import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";

export interface MemberSearchResult {
  id: string;
  username: string;
  displayName: string | null;
}

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 8;

/** Escapes ILIKE's own wildcard characters so a literal `%`/`_` in the
 * search text doesn't behave as a wildcard against the parameterized query. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Backs MemberPicker. Any authenticated Active member may call this (not
 * admin-gated — ordinary members need it to find a ticket-share recipient),
 * matching the lazy-fetch-via-Server-Action pattern already used by
 * listUploadedFiles() (returns [] for an unauthorized/no caller rather than
 * throwing, since this is a background UI fetch, not a page-level guard).
 *
 * Never selects or returns email — it's a valid search key (someone typing
 * a friend's email should still find them) but not something to echo back
 * to the searcher, since email is more sensitive than username/display
 * name and no other surface in this app displays another member's email.
 */
export async function searchMembers(query: string): Promise<MemberSearchResult[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") return [];

  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const pattern = `%${escapeLike(trimmed)}%`;
  const result = await pool.query<{ id: string; username: string; display_name: string | null }>(
    `SELECT id, username, display_name
     FROM users
     WHERE username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1
     ORDER BY COALESCE(display_name, username)
     LIMIT $2`,
    [pattern, MAX_RESULTS],
  );

  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
  }));
}
