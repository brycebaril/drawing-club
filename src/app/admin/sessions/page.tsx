import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";

interface SessionRow {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  host_username: string | null;
  booked_count: string;
  recurrence_rule_id: string | null;
  series_id: string | null;
}

export default async function AdminSessionsPage() {
  const result = await pool.query<SessionRow>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
            u.username AS host_username, s.recurrence_rule_id, s.series_id,
            (SELECT count(*) FROM passes p WHERE p.session_id = s.id AND p.status = 'Used') AS booked_count
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.status = 'Scheduled'
     ORDER BY s.start_time ASC`,
  );

  return (
    <main>
      <AdminNav />
      <h1>Sessions</h1>
      <p>
        <Link href="/admin/sessions/new">+ Create one-off session</Link> ·{" "}
        <Link href="/admin/sessions/new-recurring">+ Create recurring session</Link> ·{" "}
        <Link href="/admin/sessions/recurring">Recurring rules</Link> ·{" "}
        <Link href="/admin/sessions/new-series">+ Create multi-week series</Link> ·{" "}
        <Link href="/admin/sessions/series">Multi-week series</Link>
      </p>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Start</th>
            <th>End</th>
            <th>Booked / Capacity</th>
            <th>Host</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.session_type}</td>
              <td>{new Date(row.start_time).toLocaleString()}</td>
              <td>{new Date(row.end_time).toLocaleString()}</td>
              <td>
                {row.booked_count} / {row.max_capacity}
              </td>
              <td>{row.host_username ?? "Open — needs a host"}</td>
              <td>
                {row.recurrence_rule_id && "Recurring · "}
                {row.series_id && "Series · "}
                <Link href={`/admin/sessions/${row.id}`}>Manage</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
