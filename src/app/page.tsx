import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";
import { ORG_DBA_NAME, ORG_LEGAL_NAME } from "@/lib/org";

interface UpcomingSessionRow {
  id: string;
  session_type: string;
  start_time: Date;
  description: string | null;
}

export default async function Home() {
  const pageResult = await pool.query<{ content: string }>(
    `SELECT content FROM static_pages WHERE slug = 'home'`,
  );
  const upcomingResult = await pool.query<UpcomingSessionRow>(
    `SELECT id, session_type, start_time, description FROM sessions
     WHERE status = 'Scheduled' AND start_time >= now()
     ORDER BY start_time LIMIT 3`,
  );

  return (
    <>
      <SiteNav />
      <main>
        <h1>{ORG_DBA_NAME}</h1>
        {ORG_LEGAL_NAME !== ORG_DBA_NAME && <p className="tagline">{ORG_LEGAL_NAME}</p>}
        <p>
          Join us for figure drawing sessions, workshops, and exhibitions.{" "}
          <Link href="/app/schedule">View the schedule</Link> or <Link href="/auth/register">sign up</Link>.
        </p>

        {pageResult.rowCount! > 0 && <Markdown content={pageResult.rows[0].content} />}

        <h2>Upcoming sessions</h2>
        {upcomingResult.rowCount === 0 ? (
          <p>No upcoming sessions scheduled right now.</p>
        ) : (
          <ul>
            {upcomingResult.rows.map((session) => (
              <li key={session.id}>
                {new Date(session.start_time).toLocaleString()} — {session.session_type}
                {session.description ? `: ${session.description}` : ""}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
