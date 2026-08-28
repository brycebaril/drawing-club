import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";
import { getSettingNumber } from "@/lib/settings";
import { getSessionManagerCandidates } from "@/lib/sessions/host";
import { slotFor, startOfDay, dayIndex, toDateOnly, parseDateOnly } from "@/lib/sessions/shared";
import { SessionCalendarGrid, type OccupiedCell } from "./SessionCalendarGrid";

interface SessionRow {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  host_username: string | null;
  booked_count: string;
  recurrence_rule_id: string | null;
  series_id: string | null;
}

const SORT_COLUMNS = {
  type: "s.session_type",
  start: "s.start_time",
  end: "s.end_time",
  booked: "booked_count",
  host: "u.username",
} as const;

// The near-term management grid's window — deliberately shorter than
// new-series's 56-day/8-week window (that page is for picking many dates
// across a series' whole run; this one is for at-a-glance near-term
// scheduling), paginated forward/back the same way.
const GRID_WINDOW_DAYS = 28;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; start?: string }>;
}) {
  const { sort, dir, start } = await searchParams;
  const { state, orderBy } = resolveSort(sort, dir, SORT_COLUMNS, "start");
  const currentParams = new URLSearchParams({ sort: state.key, dir: state.dir });

  const parsedStart = start ? parseDateOnly(start) : new Date();
  const gridStart = startOfDay(Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart);
  const gridEnd = new Date(gridStart.getTime() + GRID_WINDOW_DAYS * ONE_DAY_MS);
  const gridDays = Array.from({ length: GRID_WINDOW_DAYS }, (_, i) => new Date(gridStart.getTime() + i * ONE_DAY_MS));

  const [result, gridResult, defaultCapacity, hostCandidates] = await Promise.all([
    pool.query<SessionRow>(
      `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity,
              u.username AS host_username, s.recurrence_rule_id, s.series_id,
              (SELECT count(*) FROM passes p WHERE p.session_id = s.id AND p.status = 'Used') AS booked_count
       FROM sessions s
       LEFT JOIN users u ON u.id = s.host_user_id
       WHERE s.status = 'Scheduled'
       ORDER BY ${orderBy}, s.id ASC`,
    ),
    pool.query<{ id: string; start_time: Date; session_type: string; needs_host: boolean; needs_model: boolean }>(
      `SELECT s.id, s.start_time, s.session_type,
              (s.host_user_id IS NULL) AS needs_host,
              (s.model_required AND NOT EXISTS(
                SELECT 1 FROM session_model_mapping smm WHERE smm.session_id = s.id
              )) AS needs_model
       FROM sessions s
       WHERE s.status = 'Scheduled' AND s.start_time >= $1 AND s.start_time < $2
       ORDER BY s.start_time ASC, s.id ASC`,
      [gridStart, gridEnd],
    ),
    getSettingNumber("SESSION_DEFAULT_CAPACITY"),
    getSessionManagerCandidates(),
  ]);
  // Series' seat count defaults to the same setting one-off/recurring capacity
  // does — there's only one SESSION_DEFAULT_CAPACITY setting today (matches
  // /admin/sessions/new-series's own precedent).
  const defaultSeatCount = defaultCapacity;

  // createSessionAction has no slot-conflict check for one-off sessions
  // (unlike series creation's checkSlotConflicts), so two sessions can
  // genuinely land in the same day+slot cell. Rather than silently
  // overwriting one with the other (invisible on the grid even though both
  // still exist), the first (earliest by start_time, per the ORDER BY
  // above) wins the cell and any others are counted so the UI can flag it.
  const gridOccupied: Record<string, OccupiedCell> = {};
  for (const row of gridResult.rows) {
    const date = new Date(row.start_time);
    const key = `${dayIndex(gridStart, date)}:${slotFor(date)}`;
    const existing = gridOccupied[key];
    if (existing) {
      existing.extraCount = (existing.extraCount ?? 0) + 1;
      continue;
    }
    gridOccupied[key] = {
      sessionId: row.id,
      sessionType: row.session_type,
      needsHost: row.needs_host,
      needsModel: row.needs_model,
    };
  }

  const gridNavParams = new URLSearchParams({ sort: state.key, dir: state.dir });
  const prevStart = toDateOnly(new Date(gridStart.getTime() - GRID_WINDOW_DAYS * ONE_DAY_MS));
  const nextStart = toDateOnly(new Date(gridStart.getTime() + GRID_WINDOW_DAYS * ONE_DAY_MS));
  gridNavParams.set("start", prevStart);
  const prevHref = `/admin/sessions?${gridNavParams}`;
  gridNavParams.set("start", nextStart);
  const nextHref = `/admin/sessions?${gridNavParams}`;

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Sessions</h1>
      <p>
        <Link href="/admin/sessions/new">+ Create one-off session</Link> ·{" "}
        <Link href="/admin/sessions/new-recurring">+ Create recurring session</Link> ·{" "}
        <Link href="/admin/sessions/recurring">Recurring rules</Link> ·{" "}
        <Link href="/admin/sessions/new-series">+ Create multi-week series</Link> ·{" "}
        <Link href="/admin/sessions/series">Multi-week series</Link>
      </p>

      <h2>Upcoming schedule</h2>
      <p className="section-note">
        Click an open slot to add a one-off session, recurring session, or multi-week series starting there. A
        dashed amber outline marks a scheduled session that&apos;s still incomplete — <strong>M</strong> for no
        model assigned, <strong>H</strong> for no host assigned.
      </p>
      <p>
        <Link href={prevHref}>&larr; Previous {GRID_WINDOW_DAYS / 7} weeks</Link>
        {" · "}
        <Link href={nextHref}>Next {GRID_WINDOW_DAYS / 7} weeks &rarr;</Link>
      </p>
      <SessionCalendarGrid
        days={gridDays}
        occupied={gridOccupied}
        hostCandidates={hostCandidates}
        defaultCapacity={defaultCapacity}
        defaultSeatCount={defaultSeatCount}
      />

      <h2>All sessions</h2>
      <p className="section-note">Every scheduled session, past and future — for reporting/lookup, not day-to-day scheduling.</p>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <SortableTh label="Type" columnKey="type" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <SortableTh label="Start" columnKey="start" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <SortableTh label="End" columnKey="end" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <SortableTh
              label="Booked / Capacity"
              columnKey="booked"
              pathname="/admin/sessions"
              currentParams={currentParams}
              current={state}
            />
            <SortableTh label="Host" columnKey="host" pathname="/admin/sessions" currentParams={currentParams} current={state} />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.session_type}</td>
              <td>{new Date(row.start_time).toLocaleString()}</td>
              <td>{new Date(row.end_time).toLocaleString()}</td>
              <td>
                {row.booked_count} / {row.max_capacity}
              </td>
              <td>{row.host_username ?? "Open — needs a host"}</td>
              <td>
                {row.recurrence_rule_id && "Recurring · "}
                {row.series_id && "Series · "}
                <Link href={`/admin/sessions/${row.id}`}>Manage</Link>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
