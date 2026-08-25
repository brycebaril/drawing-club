import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getCheckInRoster } from "@/lib/checkin/roster";
import { SessionRosterCard } from "../SessionRosterCard";
import { StudioGuidelines } from "../StudioGuidelines";

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const roster = await getCheckInRoster(sessionId);
  if (!roster) notFound();

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Check-in</h1>
        <SessionRosterCard initial={roster} defaultOpen />
        <StudioGuidelines />
      </main>
    </>
  );
}
