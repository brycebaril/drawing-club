import Image from "next/image";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";
import { ORG_DBA_NAME, ORG_LEGAL_NAME, ORG_TIMEZONE } from "@/lib/org";
import { isStaticOnlyLaunch, LEGACY_BOOKING_URL } from "@/lib/launchMode";

interface UpcomingSessionRow {
  id: string;
  session_type: string;
  start_time: Date;
  description: string | null;
}

export default async function Home() {
  const staticOnly = isStaticOnlyLaunch();
  const pageResult = await pool.query<{ content: string }>(
    `SELECT content FROM static_pages WHERE slug = 'home'`,
  );
  // Skipped in static-only launch mode: a fresh prod DB has no sessions
  // created yet, and "No upcoming sessions scheduled right now" would read
  // as broken rather than "coming soon" on a brand-new public launch.
  const upcomingResult = staticOnly
    ? null
    : await pool.query<UpcomingSessionRow>(
        `SELECT id, session_type, start_time, description FROM sessions
     WHERE status = 'Scheduled' AND start_time >= now()
     ORDER BY start_time LIMIT 3`,
      );

  return (
    <>
      <SiteNav />
      <main>
        <div className="hero-photo">
          <Image
            src="/photos/studio-room.jpg"
            alt="The empty studio room from the doorway: benches ringed around the model's platform, the drawing-covered back wall, and a skeleton standing by the wall. No instructor, no critique — just the model, the clock, and whoever turns up."
            fill
            className="washed washed--warm"
            style={{ objectFit: "cover", objectPosition: "50% 68%" }}
            preload
            sizes="100vw"
          />
          <div className="hero-photo-content">
            <h1>{ORG_DBA_NAME}</h1>
            {ORG_LEGAL_NAME !== ORG_DBA_NAME && <p className="tagline">{ORG_LEGAL_NAME}</p>}
            <p>
              {staticOnly ? (
                <>
                  Join us for figure drawing sessions, workshops, and exhibitions.{" "}
                  <a href={LEGACY_BOOKING_URL} target="_blank" rel="noopener noreferrer">
                    View the schedule
                  </a>{" "}
                  to book a session.
                </>
              ) : (
                <>
                  Join us for figure drawing sessions, workshops, and exhibitions.{" "}
                  <Link href="/app/schedule">View the schedule</Link> or <Link href="/auth/register">sign up</Link>.
                </>
              )}
            </p>
          </div>
        </div>

        {pageResult.rowCount! > 0 && <Markdown content={pageResult.rows[0].content} />}

        {!staticOnly && upcomingResult && (
          <>
            <h2>Upcoming sessions</h2>
            {upcomingResult.rowCount === 0 ? (
              <p>No upcoming sessions scheduled right now.</p>
            ) : (
              <ul>
                {upcomingResult.rows.map((session) => (
                  <li key={session.id}>
                    {new Date(session.start_time).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })} —{" "}
                    {session.session_type}
                    {session.description ? `: ${session.description}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}
