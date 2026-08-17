import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";

interface UserRow {
  id: string;
  username: string;
  email: string;
  status: "Active" | "Suspended" | "Banned";
  base_role: "AccountHolder" | "Admin";
  membership_expires_at: Date | null;
  volunteer_roles: string[];
}

const STATUS_OPTIONS = ["Active", "Suspended", "Banned"] as const;
const TIER_OPTIONS = ["ACCT", "MBR"] as const;
const ROLE_OPTIONS = ["ADMIN", "VOL_HOST", "VOL_MKT", "VOL_MBR", "VOL_CTRL"] as const;

const VOLUNTEER_ROLE_MAP: Record<string, string> = {
  SessionManager: "VOL_HOST",
  ContentEditor: "VOL_MKT",
  ModelBooker: "VOL_MBR",
  Controller: "VOL_CTRL",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tier?: string; role?: string }>;
}) {
  const { status, tier, role } = await searchParams;

  const result = await pool.query<UserRow>(
    `SELECT u.id, u.username, u.email, u.status, u.base_role, u.membership_expires_at,
            COALESCE(array_agg(vr.role::text) FILTER (WHERE vr.role IS NOT NULL), '{}') AS volunteer_roles
     FROM users u
     LEFT JOIN volunteer_roles vr ON vr.user_id = u.id
     GROUP BY u.id
     ORDER BY u.username ASC`,
  );

  const now = new Date();
  const rows = result.rows.filter((row) => {
    if (status && row.status !== status) return false;

    const isMember = row.membership_expires_at ? new Date(row.membership_expires_at) > now : false;
    if (tier === "MBR" && !isMember) return false;
    if (tier === "ACCT" && isMember) return false;

    if (role) {
      const mappedRoles = row.volunteer_roles.map((r) => VOLUNTEER_ROLE_MAP[r] ?? r);
      const hasRole = role === "ADMIN" ? row.base_role === "Admin" : mappedRoles.includes(role);
      if (!hasRole) return false;
    }

    return true;
  });

  return (
    <main>
      <AdminNav />
      <h1>Users</h1>

      <form>
        <label>
          Status
          <select name="status" defaultValue={status ?? ""}>
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tier
          <select name="tier" defaultValue={tier ?? ""}>
            <option value="">Any</option>
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select name="role" defaultValue={role ?? ""}>
            <option value="">Any</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Status</th>
            <th>Tier</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isMember = row.membership_expires_at
              ? new Date(row.membership_expires_at) > now
              : false;
            const mappedRoles = row.volunteer_roles.map((r) => VOLUNTEER_ROLE_MAP[r] ?? r);
            if (row.base_role === "Admin") mappedRoles.unshift("ADMIN");
            return (
              <tr key={row.id}>
                <td>
                  <a href={`/admin/users/${row.id}`}>{row.username}</a>
                </td>
                <td>{row.email}</td>
                <td>{row.status}</td>
                <td>{isMember ? "MBR" : "ACCT"}</td>
                <td>{mappedRoles.join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
