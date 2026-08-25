import { SLOTS } from "@/lib/sessions/shared";
import { EmptyCell, SessionCell } from "./SessionCell";
import type { GridCellData } from "./scheduleTypes";

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const DAY_NUMBER_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric" });

export function ScheduleGrid({ days, grid }: { days: Date[]; grid: Map<string, GridCellData> }) {
  return (
    <div className="rounded-lg border border-line bg-panel shadow-sm">
      <div className="schedule-scroll overflow-x-auto p-5">
        <div className="w-max">
          <div className="mb-2 ml-[76px] flex gap-1.5">
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
                  className={`flex w-11 shrink-0 flex-col items-center justify-end rounded-md p-0.5 pb-1 ${isWeekend ? "bg-ink/10" : ""} ${isToday ? "ring-2 ring-brand" : ""}`}
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
                <div className="w-[70px] shrink-0 border-r-2 border-line pr-2.5 text-right">
                  <span className="text-xs font-bold text-ink-soft">{slot}</span>
                </div>
                {days.map((d, dayIdx) => {
                  const cell = grid.get(`${dayIdx}:${slot}`);
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div key={dayIdx} className={`w-11 shrink-0 rounded-lg p-0.5 ${isWeekend ? "bg-ink/10" : ""}`}>
                      {cell ? <SessionCell cell={cell} href={`?session_id=${cell.id}`} /> : <EmptyCell />}
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
