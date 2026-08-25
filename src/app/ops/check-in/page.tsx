import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { startOfDay } from "@/lib/sessions/shared";
import { getCheckInRoster, getUpcomingCheckInSessions, type CheckInRoster } from "@/lib/checkin/roster";
import { SessionRosterCard } from "./SessionRosterCard";
import { StudioGuidelines } from "./StudioGuidelines";

export default async function CheckInOverviewPage() {
  const sessions = await getUpcomingCheckInSessions();
  if (!sessions) notFound();

  const rosters = (await Promise.all(sessions.map((s) => getCheckInRoster(s.id)))).filter(
    (r): r is CheckInRoster => r !== null,
  );

  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Check-in</h1>
        <p className="section-note">Sessions in the next 7 days. Tap a name to check someone in.</p>
        {rosters.length === 0 ? (
          <p>No upcoming sessions to check in.</p>
        ) : (
          rosters.map((roster) => {
            const start = new Date(roster.session.startTime);
            const isToday = start >= today && start < tomorrow;
            return <SessionRosterCard key={roster.session.id} initial={roster} defaultOpen={isToday} />;
          })
        )}
        <StudioGuidelines />
      </main>
    </>
  );
}
