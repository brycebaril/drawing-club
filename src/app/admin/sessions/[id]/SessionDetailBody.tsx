"use client";

import type { SessionDetail, AttendeeRow, SeatRow } from "./actions";
import {
  cancelOccurrenceAction,
  cancelSeriesAction,
  cancelThisAndFutureAction,
  cancelSeriesEntireSeriesAction,
  cancelSeriesThisAndFutureAction,
} from "./actions";
import { SessionDetailsEditForm } from "./SessionDetailsEditForm";
import type { HostCandidate } from "@/lib/sessions/host";

/**
 * Everything below the page heading on /admin/sessions/[id] — extracted so
 * the exact same markup, forms, and Server Actions back both the standalone
 * page and EditSessionModal (src/app/admin/sessions/EditSessionModal.tsx,
 * the calendar grid's "click a filled cell" flow), rather than the two
 * drifting apart the way this codebase has seen happen before when a detail
 * view got a second entry point. Marked "use client" because it needs to be
 * importable from EditSessionModal (a client component) — a plain Server
 * Component can't be imported into one, only passed down as children/props
 * from a Server Component ancestor. It has no state of its own either way.
 */
export function SessionDetailBody({
  session,
  attendees,
  seats,
  hostCandidates,
}: {
  session: SessionDetail;
  attendees: AttendeeRow[];
  seats: SeatRow[];
  hostCandidates: HostCandidate[];
}) {
  const isRecurring = session.recurrence_rule_id !== null;
  const isSeries = session.series_id !== null;
  const isCanceled = session.status === "Canceled";

  return (
    <>
      <h1>
        {session.session_type} — {new Date(session.start_time).toLocaleString()}
      </h1>
      <p>
        {new Date(session.start_time).toLocaleString()} – {new Date(session.end_time).toLocaleTimeString()} ·
        Capacity {isSeries ? seats.length : attendees.length}/{session.max_capacity} · Host:{" "}
        {session.host_username ?? "Open — needs a host"} · Status: {session.status}
        {isRecurring && " · Recurring occurrence"}
        {isSeries && " · Series occurrence"}
      </p>
      {session.description && <p>{session.description}</p>}

      {isSeries ? (
        <>
          <h2>Seat roster</h2>
          {seats.length === 0 ? (
            <p>No seats booked.</p>
          ) : (
            <ul>
              {seats.map((s) => (
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
          {attendees.length === 0 ? (
            <p>None booked.</p>
          ) : (
            <ul>
              {attendees.map((a) => (
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
            Canceling releases any booked tickets back to their owners&apos; balances and emails the affected
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
    </>
  );
}
