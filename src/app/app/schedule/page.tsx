import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getSettingNumber } from "@/lib/settings";
import { computeSessionStatus, type SessionStatus } from "@/lib/booking/sessionStatus";
import { SLOTS, slotFor, startOfDay, dayIndex } from "@/lib/sessions/shared";
import { bookSessionAction, cancelBookingAction, joinWaitlistAction } from "./actions";
import { SeriesPanel } from "./SeriesPanel";
import { SiteNav } from "@/components/SiteNav";

interface SessionRow {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  host_username: string | null;
  booked_count: number;
  series_id: string | null;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; bookingError?: string; seat?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/schedule");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  const [cutoffHours, accountDays, memberDays] = await Promise.all([
    getSettingNumber("CANCELLATION_CUTOFF_HOURS"),
    getSettingNumber("BOOKING_WINDOW_ACCOUNT_DAYS"),
    getSettingNumber("BOOKING_WINDOW_MEMBER_DAYS"),
  ]);

  // The grid is always drawn at the longest tier's width; each session's
  // bookability is gated per-viewer against their own window (Phase 3 plan's
  // resolved reading of Design Doc §3.1 vs §5.2 — see CLAUDE.md/plan notes).
  const gridDays = memberDays;
  const gridStart = startOfDay(new Date());
  const gridEnd = new Date(gridStart.getTime() + gridDays * 24 * 60 * 60 * 1000);

  const sessionsResult = await pool.query<SessionRow>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
            u.username AS host_username, s.series_id,
            COALESCE(bc.booked_count, 0)::int AS booked_count
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     LEFT JOIN (
       SELECT session_id, count(*) AS booked_count FROM passes WHERE status = 'Used' GROUP BY session_id
     ) bc ON bc.session_id = s.id
     WHERE s.status = 'Scheduled' AND s.start_time >= $1 AND s.start_time < $2
     ORDER BY s.start_time ASC`,
    [gridStart, gridEnd],
  );
  const sessions = sessionsResult.rows;
  const sessionIds = sessions.map((s) => s.id);

  const [bookedRows, waitlistRows] = await Promise.all([
    sessionIds.length
      ? pool.query<{ session_id: string }>(
          `SELECT session_id FROM passes WHERE owner_id = $1 AND status = 'Used' AND session_id = ANY($2::uuid[])`,
          [ctx.id, sessionIds],
        )
      : { rows: [] as { session_id: string }[] },
    sessionIds.length
      ? pool.query<{ session_id: string }>(
          `SELECT session_id FROM waitlist_entries WHERE user_id = $1 AND session_id = ANY($2::uuid[])`,
          [ctx.id, sessionIds],
        )
      : { rows: [] as { session_id: string }[] },
  ]);
  const bookedSessionIds = new Set(bookedRows.rows.map((r) => r.session_id));
  const waitlistedSessionIds = new Set(waitlistRows.rows.map((r) => r.session_id));

  const grid = new Map<string, SessionRow>(); // key: `${dayIdx}:${slot}` -> first session in that cell
  for (const s of sessions) {
    const idx = dayIndex(gridStart, new Date(s.start_time));
    const key = `${idx}:${slotFor(new Date(s.start_time))}`;
    if (!grid.has(key)) grid.set(key, s); // one session per cell for this phase (no overlap handling yet)
  }

  const days = Array.from({ length: gridDays }, (_, i) => {
    const d = new Date(gridStart.getTime() + i * 24 * 60 * 60 * 1000);
    return d;
  });

  const { session_id: selectedId, bookingError, seat } = await searchParams;
  const selectedSession = selectedId ? sessions.find((s) => s.id === selectedId) : undefined;
  const selectedSeat = seat ? Number(seat) : null;

  return (
    <>
      <SiteNav />
      <main>
        <h1>Schedule</h1>
      <p>
        Viewing as {ctx.username} ({ctx.roles.join(", ")})
      </p>

      <div style={{ overflowX: "auto" }}>
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>Slot</th>
              {days.map((d) => (
                <th key={d.toISOString()}>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <th>{slot}</th>
                {days.map((_, dayIdx) => {
                  const cellSession = grid.get(`${dayIdx}:${slot}`);
                  if (!cellSession) return <td key={dayIdx}>—</td>;

                  const status = computeSessionStatus({
                    session: {
                      startTime: new Date(cellSession.start_time),
                      maxCapacity: cellSession.max_capacity,
                    },
                    roles: ctx.roles,
                    bookedCount: cellSession.booked_count,
                    viewerHasBooking: bookedSessionIds.has(cellSession.id),
                    viewerOnWaitlist: waitlistedSessionIds.has(cellSession.id),
                    cancellationCutoffHours: cutoffHours,
                    bookingWindowAccountDays: accountDays,
                    bookingWindowMemberDays: memberDays,
                  });

                  return (
                    <td key={dayIdx}>
                      <a href={`?session_id=${cellSession.id}`}>
                        {cellSession.session_type} ({status})
                      </a>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedSession &&
        (selectedSession.series_id ? (
          <SeriesPanel
            seriesId={selectedSession.series_id}
            clickedSessionId={selectedSession.id}
            viewerId={ctx.id}
            selectedSeat={selectedSeat}
            bookingError={bookingError}
          />
        ) : (
          <SessionDetails
            session={selectedSession}
            status={computeSessionStatus({
              session: {
                startTime: new Date(selectedSession.start_time),
                maxCapacity: selectedSession.max_capacity,
              },
              roles: ctx.roles,
              bookedCount: selectedSession.booked_count,
              viewerHasBooking: bookedSessionIds.has(selectedSession.id),
              viewerOnWaitlist: waitlistedSessionIds.has(selectedSession.id),
              cancellationCutoffHours: cutoffHours,
              bookingWindowAccountDays: accountDays,
              bookingWindowMemberDays: memberDays,
            })}
            bookingError={bookingError}
          />
        ))}
      </main>
    </>
  );
}

function SessionDetails({
  session,
  status,
  bookingError,
}: {
  session: SessionRow;
  status: SessionStatus;
  bookingError?: string;
}) {
  return (
    <section>
      <h2>
        {session.session_type} — {new Date(session.start_time).toLocaleString()}
      </h2>
      <p>{session.description}</p>
      <p>
        Host: {session.host_username ?? "Open — needs a host"} · Capacity: {session.booked_count}/
        {session.max_capacity}
      </p>
      {bookingError && <p role="alert">Couldn&apos;t complete that: {bookingError}</p>}

      {status === "Available" && (
        <form action={bookSessionAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit">Book (uses 1 pass)</button>
        </form>
      )}
      {status === "Registered" && (
        <form action={cancelBookingAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit">Cancel registration</button>
        </form>
      )}
      {status === "NonCancelable" && <p>You&apos;re registered. Too close to start time to cancel.</p>}
      {status === "Full" && (
        <form action={joinWaitlistAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit">Join waitlist</button>
        </form>
      )}
      {status === "OnWaitlist" && <p>You&apos;re on the waitlist — we&apos;ll email you if a spot opens.</p>}
      {status === "TooFarFuture" && <p>Not yet bookable for your account tier.</p>}
    </section>
  );
}
