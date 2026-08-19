import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { getSessionManagerCandidates } from "@/lib/sessions/host";
import {
  cancelOccurrenceAction,
  cancelSeriesAction,
  cancelThisAndFutureAction,
  cancelSeriesEntireSeriesAction,
  cancelSeriesThisAndFutureAction,
} from "./actions";
import { SessionDetailsEditForm } from "./SessionDetailsEditForm";

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
  series_id: string | null;
}

interface AttendeeRow {
  username: string;
}

interface SeatRow {
  seat_number: number;
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
            u.username AS host_username, s.recurrence_rule_id, s.series_id
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.id = $1`,
    [id],
  );
  if (sessionResult.rowCount === 0) notFound();
  const session = sessionResult.rows[0];

  const isRecurring = session.recurrence_rule_id !== null;
  const isSeries = session.series_id !== null;
  const isCanceled = session.status === "Canceled";

  const hostCandidates = await getSessionManagerCandidates();

  const attendeesResult = isSeries
    ? { rows: [] as AttendeeRow[], rowCount: 0 }
    : await pool.query<AttendeeRow>(
        `SELECT u.username
         FROM passes p
         JOIN users u ON u.id = p.owner_id
         WHERE p.session_id = $1 AND p.status = 'Used'
         ORDER BY u.username`,
        [id],
      );

  const seatsResult = isSeries
    ? await pool.query<SeatRow>(
        `SELECT sr.seat_number, u.username
         FROM seat_reservations sr
         JOIN users u ON u.id = sr.user_id
         WHERE sr.session_id = $1
         ORDER BY sr.seat_number`,
        [id],
      )
    : { rows: [] as SeatRow[], rowCount: 0 };

  return (
    <>
      <SiteNav />
      <main>
      <h1>
        {session.session_type} — {new Date(session.start_time).toLocaleString()}
      </h1>
      <p>
        {new Date(session.start_time).toLocaleString()} – {new Date(session.end_time).toLocaleTimeString()} ·
        Capacity {isSeries ? seatsResult.rowCount : attendeesResult.rowCount}/{session.max_capacity} · Host:{" "}
        {session.host_username ?? "Open — needs a host"} · Status: {session.status}
        {isRecurring && " · Recurring occurrence"}
        {isSeries && " · Series occurrence"}
      </p>
      {session.description && <p>{session.description}</p>}

      {isSeries ? (
        <>
          <h2>Seat roster</h2>
          {seatsResult.rowCount === 0 ? (
            <p>No seats booked.</p>
          ) : (
            <ul>
              {seatsResult.rows.map((s) => (
                <li key={s.seat_number}>
                  Seat {s.seat_number}: {s.username}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
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
        </>
      )}

      {!isCanceled && (
        <>
          <h2>Edit this occurrence</h2>
          <SessionDetailsEditForm
            sessionId={session.id}
            sessionType={session.session_type}
            description={session.description ?? ""}
            maxCapacity={session.max_capacity}
            hostUsername={session.host_username ?? ""}
            hostCandidates={hostCandidates}
          />
        </>
      )}

      {!isCanceled && (
        <>
          <h2>Cancel</h2>
          <p role="alert">
            Canceling releases any booked passes back to their owners&apos; balances and emails the affected
            members.
          </p>
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
          ) : isSeries ? (
            <>
              <form action={cancelOccurrenceAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit">Cancel this occurrence only</button>
              </form>
              <form action={cancelSeriesThisAndFutureAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit">Cancel this and all future occurrences</button>
              </form>
              <form action={cancelSeriesEntireSeriesAction}>
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
    </>
  );
}
