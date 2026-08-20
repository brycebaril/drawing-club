import "./tailwind.css";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getSettingNumber } from "@/lib/settings";
import { computeSessionStatus } from "@/lib/booking/sessionStatus";
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
            u.username AS host_username, s.series_id, s.model_required,
            EXISTS(SELECT 1 FROM session_model_mapping smm WHERE smm.session_id = s.id) AS has_model,
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

  const viewerRoles = ctx.roles;
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
      <main>
        <h1>Schedule</h1>
        <p>
          Viewing as {ctx.username} ({ctx.roles.join(", ")}) · next {gridDays} days
        </p>

        <ScheduleGrid days={days} grid={grid} />
        <Legend />

        {selectedSession && (
          <Modal>
            {selectedSession.series_id ? (
              <SeriesPanel
                seriesId={selectedSession.series_id}
                clickedSessionId={selectedSession.id}
                viewerId={ctx.id}
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
              />
            )}
          </Modal>
        )}
      </main>
    </>
  );
}
