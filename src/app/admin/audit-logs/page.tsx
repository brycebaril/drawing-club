import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";
import { ORG_TIMEZONE } from "@/lib/org";

const SORT_COLUMNS = {
  when: "l.created_at",
  actor: "actor.username",
  action: "l.action_type",
  target: "target.username",
} as const;

interface AuditLogRow {
  id: string;
  actor_username: string | null;
  action_type: string;
  target_username: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ actionType?: string; sort?: string; dir?: string }>;
}) {
  const { actionType, sort, dir } = await searchParams;
  const { state, orderBy } = resolveSort(sort, dir, SORT_COLUMNS, "when", "desc");
  const currentParams = new URLSearchParams({
    ...(actionType ? { actionType } : {}),
    sort: state.key,
    dir: state.dir,
  });

  const result = await pool.query<AuditLogRow>(
    `SELECT l.id, actor.username AS actor_username, l.action_type,
            target.username AS target_username, l.metadata, l.created_at
     FROM system_audit_logs l
     LEFT JOIN users actor ON actor.id = l.actor_id
     LEFT JOIN users target ON target.id = l.target_user_id
     WHERE $1::text IS NULL OR l.action_type = $1
     ORDER BY ${orderBy}, l.id ASC
     LIMIT 200`,
    [actionType || null],
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Audit logs</h1>
      <form>
        <label htmlFor="actionType">Action type</label>
        <input id="actionType" name="actionType" defaultValue={actionType ?? ""} placeholder="e.g. ACCOUNT_STATUS_CHANGED" />
        <button type="submit">Filter</button>
      </form>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <SortableTh label="When" columnKey="when" pathname="/admin/audit-logs" currentParams={currentParams} current={state} />
            <SortableTh label="Actor" columnKey="actor" pathname="/admin/audit-logs" currentParams={currentParams} current={state} />
            <SortableTh label="Action" columnKey="action" pathname="/admin/audit-logs" currentParams={currentParams} current={state} />
            <SortableTh label="Target" columnKey="target" pathname="/admin/audit-logs" currentParams={currentParams} current={state} />
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
              <td>{row.actor_username ?? "—"}</td>
              <td>{row.action_type}</td>
              <td>{row.target_username ?? "—"}</td>
              <td>
                <code>{row.metadata ? JSON.stringify(row.metadata) : ""}</code>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
