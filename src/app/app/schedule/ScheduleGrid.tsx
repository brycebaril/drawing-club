import { SLOTS } from "@/lib/sessions/shared";
import { EmptyCell, SessionCell } from "./SessionCell";
import type { GridCellData } from "./scheduleTypes";

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const DAY_NUMBER_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric" });

// week=0 cells omit the param entirely (plain `?session_id=X`, exactly what
// every pre-pagination e2e test and Server Action redirect already expects)
// — only a genuinely paginated cell needs it, appended after session_id so
// the common case's exact string never changes.
function cellHref(sessionId: string, weekOffset: number): string {
  return weekOffset === 0 ? `?session_id=${sessionId}` : `?session_id=${sessionId}&week=${weekOffset}`;
}

export function ScheduleGrid({
  days,
  grid,
  windowDays,
  weekOffset,
}: {
  days: Date[];
  grid: Map<string, GridCellData>;
  windowDays: number;
  weekOffset: number;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel shadow-sm">
      <div className="schedule-scroll overflow-x-auto p-5">
        <div className="w-max">
          <div className="mb-2 ml-[104px] flex gap-1.5">
            {days.map((d, i) => {
              // days[0] is always today — the grid has no pagination, it's
              // always drawn from startOfDay(new Date()) (see page.tsx).
              // The ring only goes on the header, not every cell down the
              // column, per explicit feedback that repeating it read as too
              // much — the filled date badge below already carries most of
              // the "today" signal on its own.
              const isToday = i === 0;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={d.toISOString()}
                  className={`flex w-[92px] shrink-0 flex-col items-center justify-end rounded-md p-0.5 pb-1 ${isWeekend ? "bg-ink/10" : ""} ${isToday ? "ring-2 ring-brand" : ""}`}
                >
                  <span className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-soft">
                    {WEEKDAY_FORMAT.format(d)}
                  </span>
                  <span
                    className={
                      isToday
                        ? "flex h-6 w-6 items-center justify-center rounded-full bg-brand text-sm font-black text-white"
                        : "text-sm font-black text-ink"
                    }
                  >
                    {DAY_NUMBER_FORMAT.format(d)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            {SLOTS.map((slot) => (
              <div key={slot} className="flex items-center gap-1.5">
                <div className="w-[98px] shrink-0 border-r-2 border-line pr-2.5 text-right">
                  <span className="text-sm font-black text-ink" style={{ fontFamily: "var(--font-heading)" }}>
                    {slot}
                  </span>
                </div>
                {days.map((d, dayIdx) => {
                  const cell = grid.get(`${dayIdx}:${slot}`);
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div
                      key={dayIdx}
                      className={`w-[92px] shrink-0 rounded-lg p-0.5 ${isWeekend ? "bg-ink/10" : ""}`}
                    >
                      {cell ? (
                        <SessionCell cell={cell} href={cellHref(cell.id, weekOffset)} windowDays={windowDays} />
                      ) : (
                        <EmptyCell />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
