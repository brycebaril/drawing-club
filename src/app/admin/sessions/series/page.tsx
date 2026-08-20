import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { cancelSeriesFromListAction } from "./actions";

interface SeriesRow {
  id: string;
  name: string;
  seat_count: number;
  host_username: string | null;
  start_date: Date | null;
  end_date: Date | null;
  total_count: string;
  upcoming_count: string;
  first_session_id: string | null;
}

export default async function SeriesListPage() {
  const result = await pool.query<SeriesRow>(
    `SELECT sr.id, sr.name, sr.seat_count,
            (SELECT u.username FROM sessions s2
             JOIN users u ON u.id = s2.host_user_id
             WHERE s2.series_id = sr.id ORDER BY s2.start_time ASC LIMIT 1) AS host_username,
            min(s.start_time) AS start_date, max(s.start_time) AS end_date,
            count(s.id) AS total_count,
            count(s.id) FILTER (WHERE s.status = 'Scheduled' AND s.start_time > now()) AS upcoming_count,
            (SELECT s2.id FROM sessions s2 WHERE s2.series_id = sr.id ORDER BY s2.start_time ASC LIMIT 1) AS first_session_id
     FROM series sr
     LEFT JOIN sessions s ON s.series_id = sr.id
     GROUP BY sr.id
     ORDER BY min(s.start_time) DESC`,
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Multi-week series</h1>
      <p>
        <Link href="/admin/sessions/new-series">+ Create multi-week series</Link>
      </p>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Seats</th>
            <th>Host</th>
            <th>Date range</th>
            <th>Upcoming / Total occurrences</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((series) => {
            const isEnded = Number(series.upcoming_count) === 0;
            return (
              <tr key={series.id}>
                <td>
                  {series.first_session_id ? (
                    <Link href={`/admin/sessions/${series.first_session_id}`}>{series.name}</Link>
                  ) : (
                    series.name
                  )}
                </td>
                <td>{series.seat_count}</td>
                <td>{series.host_username ?? "Open — needs a host"}</td>
                <td>
                  {series.start_date ? new Date(series.start_date).toLocaleDateString() : "—"}
                  {" – "}
                  {series.end_date ? new Date(series.end_date).toLocaleDateString() : "—"}
                </td>
                <td>
                  {series.upcoming_count} / {series.total_count}
                </td>
                <td>{isEnded ? "Ended" : "Active"}</td>
                <td>
                  <Link href={`/admin/sessions/series/${series.id}`}>Edit</Link>
                  {!isEnded && (
                    <>
                      {" "}
                      <form action={cancelSeriesFromListAction}>
                        <input type="hidden" name="seriesId" value={series.id} />
                        <button type="submit">Cancel entire series</button>
                      </form>
                    </>
                  )}
                </td>
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
