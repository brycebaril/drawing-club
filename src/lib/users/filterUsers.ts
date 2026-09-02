export interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  email: string;
  status: "Active" | "Suspended" | "Banned" | "Deleted";
  base_role: "AccountHolder" | "Admin";
  membership_expires_at: Date | null;
  volunteer_roles: string[];
  cancellation_requested_at: Date | null;
}

export const VOLUNTEER_ROLE_MAP: Record<string, string> = {
  SessionManager: "VOL_HOST",
  ContentEditor: "VOL_MKT",
  ModelBooker: "VOL_MBR",
  Controller: "VOL_CTRL",
  SupportAgent: "VOL_SUPPORT",
};

/** "Paid Member" is derived from membership validity, never a stored flag (CLAUDE.md's core domain concepts). */
export function isMemberTier(row: UserRow, now: Date): boolean {
  return row.membership_expires_at ? new Date(row.membership_expires_at) > now : false;
}

export function mappedRolesFor(row: UserRow): string[] {
  const mapped = row.volunteer_roles.map((r) => VOLUNTEER_ROLE_MAP[r] ?? r);
  if (row.base_role === "Admin") mapped.unshift("ADMIN");
  return mapped;
}

/**
 * Shared by /admin/users (the page) and its CSV export, so the CSV always
 * reflects exactly the filters currently applied on the page rather than
 * duplicating this logic and risking the two drifting apart.
 */
export function filterUserRows(
  rows: UserRow[],
  filters: { status?: string; tier?: string; role?: string; q?: string; filter?: string },
  now: Date,
): UserRow[] {
  const q = filters.q?.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;

    if (filters.filter === "cancellation-requested" && !row.cancellation_requested_at) return false;

    const isMember = isMemberTier(row, now);
    if (filters.tier === "MBR" && !isMember) return false;
    if (filters.tier === "ACCT" && isMember) return false;

    if (filters.role) {
      const mappedRoles = mappedRolesFor(row);
      if (!mappedRoles.includes(filters.role)) return false;
    }

    // Display name or email only, per the search field's own label — not
    // username, which already has its own visible column and sort.
    if (q) {
      const matchesDisplayName = row.display_name?.toLowerCase().includes(q) ?? false;
      const matchesEmail = row.email.toLowerCase().includes(q);
      if (!matchesDisplayName && !matchesEmail) return false;
    }

    return true;
  });
}
