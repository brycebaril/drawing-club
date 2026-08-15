import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";
import { cancelOccurrenceAction, cancelSeriesAction, cancelThisAndFutureAction } from "./actions";

interface SessionDetail {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  status: "Scheduled" | "Canceled";
  host_username: string | null;
  recurrence_rule_id: string | null;
}

interface AttendeeRow {
  username: string;
}

export default async function AdminSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sessionResult = await pool.query<SessionDetail>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity, s.status,
            u.username AS host_username, s.recurrence_rule_id
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.id = $1`,
    [id],
  );
  if (sessionResult.rowCount === 0) notFound();
  const session = sessionResult.rows[0];

  const attendeesResult = await pool.query<AttendeeRow>(
    `SELECT u.username
     FROM passes p
     JOIN users u ON u.id = p.owner_id
     WHERE p.session_id = $1 AND p.status = 'Used'
     ORDER BY u.username`,
    [id],
  );

  const isRecurring = session.recurrence_rule_id !== null;
  const isCanceled = session.status === "Canceled";

  return (
    <main>
      <AdminNav />
      <h1>
        {session.session_type} — {new Date(session.start_time).toLocaleString()}
      </h1>
      <p>
        {new Date(session.start_time).toLocaleString()} – {new Date(session.end_time).toLocaleTimeString()} ·
        Capacity {attendeesResult.rowCount}/{session.max_capacity} · Host:{" "}
        {session.host_username ?? "Open — needs a host"} · Status: {session.status}
        {isRecurring && " · Recurring occurrence"}
      </p>
      {session.description && <p>{session.description}</p>}

      <h2>Attendees</h2>
      {attendeesResult.rowCount === 0 ? (
        <p>None booked.</p>
      ) : (
        <ul>
          {attendeesResult.rows.map((a) => (
            <li key={a.username}>{a.username}</li>
          ))}
        </ul>
      )}

      {!isCanceled && (
        <>
          <h2>Cancel</h2>
          {isRecurring ? (
            <>
              <form action={cancelOccurrenceAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit">Cancel this occurrence only</button>
              </form>
              <form action={cancelThisAndFutureAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit">Cancel this and all future occurrences</button>
              </form>
              <form action={cancelSeriesAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit">Cancel the entire series</button>
              </form>
            </>
          ) : (
            <form action={cancelOccurrenceAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button type="submit">Cancel this session</button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
