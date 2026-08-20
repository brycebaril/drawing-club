import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";
import { filterUserRows, isMemberTier, mappedRolesFor, type UserRow } from "@/lib/users/filterUsers";

const STATUS_OPTIONS = ["Active", "Suspended", "Banned"] as const;
const TIER_OPTIONS = ["ACCT", "MBR"] as const;
const ROLE_OPTIONS = ["ADMIN", "VOL_HOST", "VOL_MKT", "VOL_MBR", "VOL_CTRL"] as const;

const SORT_COLUMNS = {
  username: "u.username",
  displayName: "u.display_name",
  email: "u.email",
  status: "u.status",
  // Tier (MBR/ACCT) is derived from membership_expires_at, not a stored
  // flag — sorting by the underlying column groups active members together.
  tier: "u.membership_expires_at",
} as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tier?: string; role?: string; q?: string; sort?: string; dir?: string }>;
}) {
  const { status, tier, role, q, sort, dir } = await searchParams;
  const { state, orderBy } = resolveSort(sort, dir, SORT_COLUMNS, "username");

  const result = await pool.query<UserRow>(
    `SELECT u.id, u.username, u.display_name, u.email, u.status, u.base_role, u.membership_expires_at,
            COALESCE(array_agg(vr.role::text) FILTER (WHERE vr.role IS NOT NULL), '{}') AS volunteer_roles
     FROM users u
     LEFT JOIN volunteer_roles vr ON vr.user_id = u.id
     GROUP BY u.id
     ORDER BY ${orderBy}, u.id ASC`,
  );

  const now = new Date();
  const rows = filterUserRows(result.rows, { status, tier, role, q }, now);

  const csvParams = new URLSearchParams();
  if (status) csvParams.set("status", status);
  if (tier) csvParams.set("tier", tier);
  if (role) csvParams.set("role", role);
  if (q) csvParams.set("q", q);
  const csvHref = `/admin/users/csv${csvParams.size > 0 ? `?${csvParams}` : ""}`;

  const currentParams = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(tier ? { tier } : {}),
    ...(role ? { role } : {}),
    ...(q ? { q } : {}),
    sort: state.key,
    dir: state.dir,
  });

  return (
    <>
      <SiteNav />
      <main>
      <h1>Users</h1>

      <form>
        <label>
          Search (display name or email)
          <input type="text" name="q" defaultValue={q ?? ""} placeholder="e.g. jane@example.com" />
        </label>
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

      <div className="table-scroll">

        <table>
        <thead>
          <tr>
            <SortableTh label="Username" columnKey="username" pathname="/admin/users" currentParams={currentParams} current={state} />
            <SortableTh
              label="Display name"
              columnKey="displayName"
              pathname="/admin/users"
              currentParams={currentParams}
              current={state}
            />
            <SortableTh label="Email" columnKey="email" pathname="/admin/users" currentParams={currentParams} current={state} />
            <SortableTh label="Status" columnKey="status" pathname="/admin/users" currentParams={currentParams} current={state} />
            <SortableTh label="Tier" columnKey="tier" pathname="/admin/users" currentParams={currentParams} current={state} />
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
                <td>{row.display_name ?? "—"}</td>
                <td>{row.email}</td>
                <td>{row.status}</td>
                <td>{isMember ? "MBR" : "ACCT"}</td>
                <td>{mappedRoles.join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
