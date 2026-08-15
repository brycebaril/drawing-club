import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";

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
  searchParams: Promise<{ actionType?: string }>;
}) {
  const { actionType } = await searchParams;

  const result = await pool.query<AuditLogRow>(
    `SELECT l.id, actor.username AS actor_username, l.action_type,
            target.username AS target_username, l.metadata, l.created_at
     FROM system_audit_logs l
     LEFT JOIN users actor ON actor.id = l.actor_id
     LEFT JOIN users target ON target.id = l.target_user_id
     WHERE $1::text IS NULL OR l.action_type = $1
     ORDER BY l.created_at DESC
     LIMIT 200`,
    [actionType || null],
  );

  return (
    <main>
      <AdminNav />
      <h1>Audit logs</h1>
      <form>
        <label htmlFor="actionType">Action type</label>
        <input id="actionType" name="actionType" defaultValue={actionType ?? ""} placeholder="e.g. ACCOUNT_STATUS_CHANGED" />
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString()}</td>
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
    </main>
  );
}
