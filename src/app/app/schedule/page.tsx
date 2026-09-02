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
import { ScheduleAgenda } from "./ScheduleAgenda";
import { Legend } from "./Legend";
import { Modal } from "./Modal";
import { SiteNav } from "@/components/SiteNav";
import { formatOpensDate, formatWeekRange, type GridCellData } from "./scheduleTypes";
import { displayModelNames } from "@/lib/models/modelName";
import { memberLabel } from "@/lib/users/memberLabel";

const WEEK_LENGTH_DAYS = 7;

interface SessionRow {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  host_username: string | null;
  host_display_name: string | null;
  booked_count: number;
  series_id: string | null;
  model_required: boolean;
  has_model: boolean;
  model_names: string | null;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; bookingError?: string; seat?: string; week?: string }>;
}) {
  // Unified public + member page (see src/lib/auth/rbac.ts's dedicated
  // public rule for this exact route) — a guest sees the same grid and
  // detail modal as a member, just with login-gated actions instead of
  // real booking forms. ctx is null for a guest; every downstream query and
  // computation that depends on a viewer identity accounts for that.
  const session = await auth();
  const ctx = session?.user?.id ? await getUserAuthContext(session.user.id) : null;

  const {
    session_id: selectedId,
    bookingError,
    seat,
    week: weekParam,
  } = await searchParams;

  const [cutoffHours, accountDays, memberDays] = await Promise.all([
    getSettingNumber("CANCELLATION_CUTOFF_HOURS"),
    getSettingNumber("BOOKING_WINDOW_ACCOUNT_DAYS"),
    getSettingNumber("BOOKING_WINDOW_MEMBER_DAYS"),
  ]);

  // The grid pages a week at a time (Design Philosophy.dc.html §04) but is
  // still "drawn at the longest tier's width" in the sense that matters: how
  // far paging can reach. maxWeekOffset bounds it to memberDays — the same
  // total window the page rendered in one shot before pagination existed —
  // not a per-viewer bound, since per-viewer gating already happens at the
  // status level (computeSessionStatus) regardless of which week is on
  // screen. An Account Holder paging past their own shorter window still
  // sees a real session there, just Locked ("opens" pitch) rather than
  // bookable — never widened, only ever visible further out, matching the
  // doc's own framing of the opens-date as "also the membership pitch."
  const today = startOfDay(new Date());
  const maxWeekOffset = Math.max(0, Math.ceil(memberDays / WEEK_LENGTH_DAYS) - 1);
  const rawWeek = Number(weekParam ?? "0");
  const weekOffset = Number.isFinite(rawWeek) ? Math.min(Math.max(Math.trunc(rawWeek), 0), maxWeekOffset) : 0;
  const viewStart = new Date(today.getTime() + weekOffset * WEEK_LENGTH_DAYS * 24 * 60 * 60 * 1000);
  const viewEnd = new Date(viewStart.getTime() + WEEK_LENGTH_DAYS * 24 * 60 * 60 * 1000);

  const sessionsResult = await pool.query<SessionRow>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
            u.username AS host_username, u.display_name AS host_display_name, s.series_id, s.model_required,
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
    [viewStart, viewEnd],
  );
  const sessions = sessionsResult.rows;

  // A deep link (a Book/Cancel/Waitlist action's own redirect, an email
  // link, a stale bookmark) always points at a bare `?session_id=`, with no
  // `week` — it always lands back on week 0 regardless of which week was
  // showing when the action was taken. Rather than thread `week` through
  // every Server Action redirect too, the selected session is looked up on
  // its own here whenever it isn't already in the displayed week's own
  // query result, so the confirmation modal is always correct even though
  // the grid behind it may visibly reset to week 0 in that case — a minor,
  // disclosed rough edge, not a broken modal.
  let selectedSession = selectedId ? sessions.find((s) => s.id === selectedId) : undefined;
  if (selectedId && !selectedSession) {
    const singleResult = await pool.query<SessionRow>(
      `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
              u.username AS host_username, u.display_name AS host_display_name, s.series_id, s.model_required,
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
       WHERE s.id = $1`,
      [selectedId],
    );
    selectedSession = singleResult.rows[0];
  }

  // sessionIds always includes the selected session even when it came from
  // the fallback lookup above, so its own booked/waitlist membership is
  // still checked correctly rather than defaulting to false.
  const sessionIds = sessions.map((s) => s.id);
  if (selectedSession && !sessionIds.includes(selectedSession.id)) sessionIds.push(selectedSession.id);

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
    const idx = dayIndex(viewStart, new Date(s.start_time));
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
        hostDisplayName: s.host_display_name,
        modelRequired: s.model_required,
        modelNames: displayModelNames(s.model_names, viewerRoles),
        bookedCount: s.booked_count,
        maxCapacity: s.max_capacity,
      }); // one session per cell for this phase (no overlap handling yet)
    }
  }

  const days = Array.from(
    { length: WEEK_LENGTH_DAYS },
    (_, i) => new Date(viewStart.getTime() + i * 24 * 60 * 60 * 1000),
  );

  const selectedSeat = seat ? Number(seat) : null;

  // Number.isFinite guard for the same reason as SessionCell's own —
  // ADMIN's window is Infinity, and "booking open through Infinity days from
  // now" isn't a sentence.
  const bookingOpenThrough = Number.isFinite(viewerWindowDays)
    ? formatOpensDate(new Date(today.getTime() + viewerWindowDays * 24 * 60 * 60 * 1000))
    : null;

  const prevWeekOffset = Math.max(0, weekOffset - 1);
  const nextWeekOffset = Math.min(maxWeekOffset, weekOffset + 1);

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Schedule</h1>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>{formatWeekRange(viewStart, viewEnd)}</h2>
            <p style={{ margin: 0 }}>
              {ctx ? (
                <>
                  Viewing as {memberLabel(ctx.displayName, ctx.username)} ({ctx.roles.join(", ")})
                  {bookingOpenThrough && <> · booking open through {bookingOpenThrough}</>}
                </>
              ) : (
                <>
                  <a href="/auth/login?redirect=/app/schedule">Log in</a> to book a session
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {weekOffset > 0 ? (
              <a
                href={`?week=${prevWeekOffset}`}
                className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-bold text-ink hover:border-brand"
              >
                ← Previous week
              </a>
            ) : (
              <span className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-ink-soft opacity-50">
                ← Previous week
              </span>
            )}
            {weekOffset !== 0 && (
              <a
                href="?"
                className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-bold text-ink hover:border-brand"
              >
                This week
              </a>
            )}
            {weekOffset < maxWeekOffset ? (
              <a
                href={`?week=${nextWeekOffset}`}
                className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-bold text-ink hover:border-brand"
              >
                Next week →
              </a>
            ) : (
              <span className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-ink-soft opacity-50">
                Next week →
              </span>
            )}
          </div>
        </div>

        {/* Design Philosophy.dc.html §06: the grid doesn't survive a phone —
            below the breakpoint an agenda list replaces it. Both render
            server-side; only a CSS breakpoint decides which is visible, so
            there's no client JS and no hydration mismatch to worry about.
            Both carry every session's own link/tooltip, so a plain
            `a[href*="session_id=..."]` or `[title*="..."]` e2e locator now
            matches one in each — id'd here specifically so e2e specs can
            scope to the surface that's actually visible at their project's
            viewport (every existing spec runs the desktop "chromium"
            project against the grid).

            960px, not the doc's own stated 824px: that figure is ScheduleGrid's
            raw content width (7×92px cells + the 100px rail + gaps), but the
            breakpoint has to compare against the full viewport — which also
            has to fit main.main--wide's own horizontal margins
            (2×var(--space-5) = 48px) and a scrollbar (~15-17px) around that
            content. Using 824px directly left a real dead zone (roughly
            824-890px) where the grid rendered instead of the agenda but still
            needed its own horizontal scroll to fit — confirmed by computing
            ScheduleGrid's actual rendered width (~838px, close to but not
            exactly the doc's figure) plus that overhead (≈903px minimum),
            then rounding up for safety margin. */}
        <div id="schedule-grid-view" className="hidden min-[960px]:block">
          <ScheduleGrid days={days} grid={grid} windowDays={viewerWindowDays} weekOffset={weekOffset} />
        </div>
        <div id="schedule-agenda-view" className="min-[960px]:hidden">
          <ScheduleAgenda days={days} grid={grid} windowDays={viewerWindowDays} weekOffset={weekOffset} />
        </div>
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
