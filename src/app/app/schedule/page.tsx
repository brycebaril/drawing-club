import "./tailwind.css";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getSettingNumber } from "@/lib/settings";
import { computeSessionStatus, viewerBookingWindowDays } from "@/lib/booking/sessionStatus";
import { slotFor, startOfDay, dayIndex } from "@/lib/sessions/shared";
import { SeriesPanel } from "./SeriesPanel";
import { SessionDetailsPanel } from "./SessionDetailsPanel";
import { ScheduleGrid } from "./ScheduleGrid";
import { Legend } from "./Legend";
import { Modal } from "./Modal";
import { SiteNav } from "@/components/SiteNav";
import type { GridCellData } from "./scheduleTypes";

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
  model_required: boolean;
  has_model: boolean;
  model_names: string | null;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; bookingError?: string; seat?: string }>;
}) {
  // Unified public + member page (see src/lib/auth/rbac.ts's dedicated
  // public rule for this exact route) — a guest sees the same grid and
  // detail modal as a member, just with login-gated actions instead of
  // real booking forms. ctx is null for a guest; every downstream query and
  // computation that depends on a viewer identity accounts for that.
  const session = await auth();
  const ctx = session?.user?.id ? await getUserAuthContext(session.user.id) : null;

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
            u.username AS host_username, s.series_id, s.model_required,
            EXISTS(SELECT 1 FROM session_model_mapping smm WHERE smm.session_id = s.id) AS has_model,
            mn.model_names,
            COALESCE(bc.booked_count, 0)::int AS booked_count
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     LEFT JOIN (
       SELECT session_id, count(*) AS booked_count FROM passes WHERE status = 'Used' GROUP BY session_id
     ) bc ON bc.session_id = s.id
     LEFT JOIN (
       SELECT smm.session_id, string_agg(m.name, ', ') AS model_names
       FROM session_model_mapping smm JOIN models m ON m.id = smm.model_id
       GROUP BY smm.session_id
     ) mn ON mn.session_id = s.id
     WHERE s.status = 'Scheduled' AND s.start_time >= $1 AND s.start_time < $2
     ORDER BY s.start_time ASC`,
    [gridStart, gridEnd],
  );
  const sessions = sessionsResult.rows;
  const sessionIds = sessions.map((s) => s.id);

  // A guest never has a booking or waitlist entry — skip both queries
  // entirely rather than querying with a userId that doesn't exist.
  const [bookedRows, waitlistRows] = await Promise.all([
    ctx && sessionIds.length
      ? pool.query<{ session_id: string }>(
          `SELECT session_id FROM passes WHERE owner_id = $1 AND status = 'Used' AND session_id = ANY($2::uuid[])`,
          [ctx.id, sessionIds],
        )
      : { rows: [] as { session_id: string }[] },
    ctx && sessionIds.length
      ? pool.query<{ session_id: string }>(
          `SELECT session_id FROM waitlist_entries WHERE user_id = $1 AND session_id = ANY($2::uuid[])`,
          [ctx.id, sessionIds],
        )
      : { rows: [] as { session_id: string }[] },
  ]);
  const bookedSessionIds = new Set(bookedRows.rows.map((r) => r.session_id));
  const waitlistedSessionIds = new Set(waitlistRows.rows.map((r) => r.session_id));

  const viewerRoles = ctx?.roles ?? null;
  // Used by a Locked cell to say "Opens {date}" instead of just being dimmed
  // (Design Philosophy.dc.html §03) — Infinity for ADMIN, but TooFarFuture
  // never actually occurs for an unrestricted viewer, so SessionCell's own
  // Number.isFinite guard is what matters, not clamping this value itself.
  const viewerWindowDays = viewerBookingWindowDays(viewerRoles, accountDays, memberDays);
  function statusFor(s: SessionRow) {
    return computeSessionStatus({
      session: { startTime: new Date(s.start_time), maxCapacity: s.max_capacity },
      roles: viewerRoles,
      bookedCount: s.booked_count,
      viewerHasBooking: bookedSessionIds.has(s.id),
      viewerOnWaitlist: waitlistedSessionIds.has(s.id),
      cancellationCutoffHours: cutoffHours,
      bookingWindowAccountDays: accountDays,
      bookingWindowMemberDays: memberDays,
    });
  }

  const grid = new Map<string, GridCellData>(); // key: `${dayIdx}:${slot}` -> first session in that cell
  for (const s of sessions) {
    const idx = dayIndex(gridStart, new Date(s.start_time));
    const key = `${idx}:${slotFor(new Date(s.start_time))}`;
    if (!grid.has(key)) {
      grid.set(key, {
        id: s.id,
        sessionType: s.session_type,
        status: statusFor(s),
        needsModel: s.model_required && !s.has_model,
        description: s.description,
        startTime: new Date(s.start_time),
        endTime: new Date(s.end_time),
        hostUsername: s.host_username,
        modelRequired: s.model_required,
        modelNames: s.model_names,
        bookedCount: s.booked_count,
        maxCapacity: s.max_capacity,
      }); // one session per cell for this phase (no overlap handling yet)
    }
  }

  const days = Array.from({ length: gridDays }, (_, i) => new Date(gridStart.getTime() + i * 24 * 60 * 60 * 1000));

  const { session_id: selectedId, bookingError, seat } = await searchParams;
  const selectedSession = selectedId ? sessions.find((s) => s.id === selectedId) : undefined;
  const selectedSeat = seat ? Number(seat) : null;

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Schedule</h1>
        <p>
          {ctx ? (
            <>
              Viewing as {ctx.username} ({ctx.roles.join(", ")}) · next {gridDays} days
            </>
          ) : (
            <>
              <a href="/auth/login?redirect=/app/schedule">Log in</a> to book a session · next {gridDays} days
            </>
          )}
        </p>

        <ScheduleGrid days={days} grid={grid} windowDays={viewerWindowDays} />
        <Legend />

        {selectedSession && (
          <Modal>
            {selectedSession.series_id ? (
              <SeriesPanel
                seriesId={selectedSession.series_id}
                clickedSessionId={selectedSession.id}
                viewerId={ctx?.id ?? null}
                selectedSeat={selectedSeat}
                bookingError={bookingError}
                cutoffHours={cutoffHours}
              />
            ) : (
              <SessionDetailsPanel
                session={selectedSession}
                status={statusFor(selectedSession)}
                needsModel={selectedSession.model_required && !selectedSession.has_model}
                bookingError={bookingError}
                loggedIn={ctx !== null}
              />
            )}
          </Modal>
        )}
      </main>
    </>
  );
}
