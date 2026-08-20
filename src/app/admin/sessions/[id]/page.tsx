import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getSessionManagerCandidates } from "@/lib/sessions/host";
import { getSessionDetail } from "./actions";
import { SessionDetailBody } from "./SessionDetailBody";

export default async function AdminSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const detail = await getSessionDetail(id);
  if (!detail) notFound();

  const hostCandidates = await getSessionManagerCandidates();

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <SessionDetailBody
          session={detail.session}
          attendees={detail.attendees}
          seats={detail.seats}
          hostCandidates={hostCandidates}
        />
      </main>
    </>
  );
}
