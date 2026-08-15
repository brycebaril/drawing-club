import { pool } from "@/lib/db/pool";

interface SessionRow {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  host_username: string | null;
  booked_count: string;
}

export default async function AdminSessionsPage() {
  const result = await pool.query<SessionRow>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
            u.username AS host_username,
            (SELECT count(*) FROM passes p WHERE p.session_id = s.id AND p.status = 'Used') AS booked_count
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.status = 'Scheduled'
     ORDER BY s.start_time ASC`,
  );

  return (
    <main>
      <h1>Sessions</h1>
      <p>
        <a href="/admin/sessions/new">+ Create one-off session</a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Start</th>
            <th>End</th>
            <th>Booked / Capacity</th>
            <th>Host</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
