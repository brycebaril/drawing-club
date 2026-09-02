import { cache } from "react";
import { pool } from "@/lib/db/pool";

// SiteOutline.md §2's RBAC role codes. GUEST is implicit (absence of a
// session) and never appears in a resolved user's role set.
export type Role =
  | "ACCT"
  | "MBR"
  | "VOL_HOST"
  | "VOL_MKT"
  | "VOL_MBR"
  | "VOL_CTRL"
  | "VOL_SUPPORT"
  | "ADMIN";

const VOLUNTEER_ROLE_MAP: Record<string, Role> = {
  SessionManager: "VOL_HOST",
  ContentEditor: "VOL_MKT",
  ModelBooker: "VOL_MBR",
  Controller: "VOL_CTRL",
  SupportAgent: "VOL_SUPPORT",
};

export interface UserAuthContext {
  id: string;
  username: string;
  displayName: string | null;
  status: "Active" | "Suspended" | "Banned" | "Deleted";
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** Design Doc §5.1 / SecurityDocument.md §2: ADMIN and VOL_CTRL require MFA. */
  mfaRequired: boolean;
  /** Does not include GUEST — an authenticated user always has at least ACCT. */
  roles: Role[];
}

/**
 * cache()-wrapped: within one React render (a page and SiteNav both calling
 * this with the same userId, say), the second call reuses the first's
 * in-flight promise instead of re-querying. Doesn't affect src/proxy.ts's
 * own call — that runs outside the React render tree, so cache() there is
 * just a passthrough.
 */
export const getUserAuthContext = cache(async (userId: string): Promise<UserAuthContext | null> => {
  // Neither query depends on the other's result, so run them concurrently —
  // this function is on the hottest path in the app (src/proxy.ts calls it
  // fresh on every non-API request).
  const [userResult, volunteerResult] = await Promise.all([
    pool.query(
      `SELECT id, username, display_name, status, email_verified_at, mfa_enabled, base_role, membership_expires_at
       FROM users WHERE id = $1`,
      [userId],
    ),
    pool.query(`SELECT role FROM volunteer_roles WHERE user_id = $1`, [userId]),
  ]);
  if (userResult.rowCount === 0) return null;
  const user = userResult.rows[0];

  const roles: Role[] = ["ACCT"];
  if (user.membership_expires_at && new Date(user.membership_expires_at) > new Date()) {
    roles.push("MBR");
  }
  if (user.base_role === "Admin") {
    roles.push("ADMIN");
  }
  for (const row of volunteerResult.rows) {
    const mapped = VOLUNTEER_ROLE_MAP[row.role];
    if (mapped) roles.push(mapped);
  }

  const mfaRequired = roles.includes("ADMIN") || roles.includes("VOL_CTRL");

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    status: user.status,
    emailVerified: user.email_verified_at !== null,
    mfaEnabled: user.mfa_enabled,
    mfaRequired,
    roles,
  };
});

export async function getUserAuthContextByUsername(
  username: string,
): Promise<UserAuthContext | null> {
  const result = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (result.rowCount === 0) return null;
  return getUserAuthContext(result.rows[0].id);
}
