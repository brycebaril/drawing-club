import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";

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

const SORT_COLUMNS = {
  type: "s.session_type",
  start: "s.start_time",
  end: "s.end_time",
  booked: "booked_count",
  host: "u.username",
} as const;

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const { sort, dir } = await searchParams;
  const { state, orderBy } = resolveSort(sort, dir, SORT_COLUMNS, "start");
  const currentParams = new URLSearchParams({ sort: state.key, dir: state.dir });

  const result = await pool.query<SessionRow>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
            u.username AS host_username, s.recurrence_rule_id, s.series_id,
            (SELECT count(*) FROM passes p WHERE p.session_id = s.id AND p.status = 'Used') AS booked_count
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.status = 'Scheduled'
     ORDER BY ${orderBy}, s.id ASC`,
  );

  return (
    <>
      <SiteNav />
      <main>
      <h1>Sessions</h1>
      <p>
        <Link href="/admin/sessions/new">+ Create one-off session</Link> ·{" "}
        <Link href="/admin/sessions/new-recurring">+ Create recurring session</Link> ·{" "}
        <Link href="/admin/sessions/recurring">Recurring rules</Link> ·{" "}
        <Link href="/admin/sessions/new-series">+ Create multi-week series</Link> ·{" "}
        <Link href="/admin/sessions/series">Multi-week series</Link>
      </p>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <SortableTh label="Type" columnKey="type" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <SortableTh label="Start" columnKey="start" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <SortableTh label="End" columnKey="end" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <SortableTh
              label="Booked / Capacity"
              columnKey="booked"
              pathname="/admin/sessions"
              currentParams={currentParams}
              current={state}
            />
            <SortableTh label="Host" columnKey="host" pathname="/admin/sessions" currentParams={currentParams} current={state} />
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
      </div>
    </main>
    </>
  );
}
