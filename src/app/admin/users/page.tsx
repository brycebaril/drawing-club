import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";
import { filterUserRows, isMemberTier, mappedRolesFor, type UserRow } from "@/lib/users/filterUsers";

const STATUS_OPTIONS = ["Active", "Suspended", "Banned"] as const;
const TIER_OPTIONS = ["ACCT", "MBR"] as const;
const ROLE_OPTIONS = ["ADMIN", "VOL_HOST", "VOL_MKT", "VOL_MBR", "VOL_CTRL"] as const;

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
  const rows = filterUserRows(result.rows, { status, tier, role }, now);

  const csvParams = new URLSearchParams();
  if (status) csvParams.set("status", status);
  if (tier) csvParams.set("tier", tier);
  if (role) csvParams.set("role", role);
  const csvHref = `/admin/users/csv${csvParams.size > 0 ? `?${csvParams}` : ""}`;

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

      <p>
        <a href={csvHref}>Download CSV</a>
      </p>

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
            const isMember = isMemberTier(row, now);
            const mappedRoles = mappedRolesFor(row);
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
