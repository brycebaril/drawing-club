import { SLOTS } from "@/lib/sessions/shared";
import { EmptyCell, SessionCell } from "./SessionCell";
import type { GridCellData } from "./scheduleTypes";

export function ScheduleGrid({ days, grid }: { days: Date[]; grid: Map<string, GridCellData> }) {
  return (
    <div className="rounded-lg border border-line bg-panel shadow-sm">
      <div className="schedule-scroll overflow-x-auto p-5">
        <div className="w-max">
          <div className="mb-2 ml-[76px] flex gap-1.5">
            {days.map((d, i) => (
              <div key={d.toISOString()} className="flex w-11 shrink-0 flex-col items-center justify-end pb-1">
                <span className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-soft">
                  {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d)}
                </span>
                <span
                  className={
                    i === 0
                      ? "flex h-6 w-6 items-center justify-center rounded-full bg-brand text-sm font-black text-white"
                      : "text-sm font-black text-ink"
                  }
                >
                  {new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(d)}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {SLOTS.map((slot) => (
              <div key={slot} className="flex items-center gap-1.5">
                <div className="w-[70px] shrink-0 border-r-2 border-line pr-2.5 text-right">
                  <span className="text-xs font-bold text-ink-soft">{slot}</span>
                </div>
                {days.map((d, dayIdx) => {
                  const cell = grid.get(`${dayIdx}:${slot}`);
                  return (
                    <div key={dayIdx} className="shrink-0">
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

